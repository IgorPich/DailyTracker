use crate::legacy_bootstrap::{reconstruct_with_connection, write_materialized_snapshot};
use crate::sync_repository::{
    apply_mutation_in_transaction, require_authoritative_bootstrap, MutationOrigin,
};
use crate::{
    NativeAppDataStore, OutboxOperation, StorageError, StorageResult, SyncEntityRecord,
    SyncMutationRequest, SyncOperationType,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncRemoteState {
    pub service_id: String,
    pub certificate_fingerprint_sha256: String,
    pub last_known_host: String,
    pub last_pulled_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreparedRemoteOperation {
    pub request: SyncMutationRequest,
    pub local_result_revision: i64,
    pub attempt_count: i64,
}

impl NativeAppDataStore {
    pub fn register_sync_remote(
        &self,
        service_id: &str,
        certificate_fingerprint_sha256: &str,
        last_known_host: &str,
    ) -> StorageResult<SyncRemoteState> {
        validate_remote_identity(service_id, certificate_fingerprint_sha256, last_known_host)?;
        self.with_connection(|connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute(
                r#"
                INSERT INTO sync_remotes (
                  service_id, certificate_fingerprint_sha256, last_known_host
                ) VALUES (?1, ?2, ?3)
                ON CONFLICT(service_id) DO UPDATE SET
                  certificate_fingerprint_sha256 = excluded.certificate_fingerprint_sha256,
                  last_known_host = excluded.last_known_host,
                  updated_at = CURRENT_TIMESTAMP
                "#,
                params![service_id, certificate_fingerprint_sha256, last_known_host],
            )?;
            let remote =
                load_remote_with_connection(&transaction, service_id)?.ok_or_else(|| {
                    StorageError::InvalidData("sync remote disappeared after registration".into())
                })?;
            transaction.commit()?;
            Ok(remote)
        })
    }

    pub fn load_sync_remote(&self, service_id: &str) -> StorageResult<Option<SyncRemoteState>> {
        self.with_connection(|connection| load_remote_with_connection(connection, service_id))
    }

    pub fn list_sync_remotes(&self) -> StorageResult<Vec<SyncRemoteState>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                r#"
                SELECT service_id, certificate_fingerprint_sha256,
                       last_known_host, last_pulled_revision
                FROM sync_remotes
                ORDER BY created_at, service_id
                "#,
            )?;
            let rows = statement.query_map([], sync_remote_from_row)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
        })
    }

    pub fn update_sync_remote_host(
        &self,
        service_id: &str,
        last_known_host: &str,
    ) -> StorageResult<bool> {
        if !valid_https_host(last_known_host) {
            return Err(StorageError::InvalidMutation(
                "last known sync host must use HTTPS".into(),
            ));
        }
        self.with_connection(|connection| {
            Ok(connection.execute(
                r#"
                UPDATE sync_remotes
                SET last_known_host = ?2, updated_at = CURRENT_TIMESTAMP
                WHERE service_id = ?1
                "#,
                params![service_id, last_known_host],
            )? == 1)
        })
    }

    pub fn prepare_remote_outbox(
        &self,
        service_id: &str,
        limit: usize,
    ) -> StorageResult<Vec<PreparedRemoteOperation>> {
        let operations = self.pending_outbox(limit)?;
        self.with_connection(|connection| {
            if load_remote_with_connection(connection, service_id)?.is_none() {
                return Err(StorageError::InvalidMutation(format!(
                    "unknown sync remote {service_id}"
                )));
            }
            operations
                .into_iter()
                .map(|operation| prepare_operation(connection, service_id, operation))
                .collect()
        })
    }

    pub fn acknowledge_remote_operation(
        &self,
        service_id: &str,
        operation_id: &str,
        remote_revision: i64,
    ) -> StorageResult<bool> {
        if remote_revision <= 0 {
            return Err(StorageError::InvalidMutation(
                "accepted remote revision must be positive".into(),
            ));
        }
        self.with_connection(|connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let entity = transaction
                .query_row(
                    r#"
                    SELECT entity_type, entity_id
                    FROM sync_outbox
                    WHERE operation_id = ?1 AND acknowledged_at IS NULL
                    "#,
                    [operation_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            let Some((entity_type, entity_id)) = entity else {
                transaction.commit()?;
                return Ok(false);
            };
            require_remote(&transaction, service_id)?;
            transaction.execute(
                r#"
                INSERT INTO sync_remote_entities (
                  service_id, entity_type, entity_id, remote_revision
                ) VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(service_id, entity_type, entity_id) DO UPDATE SET
                  remote_revision = excluded.remote_revision,
                  updated_at = CURRENT_TIMESTAMP
                "#,
                params![service_id, entity_type, entity_id, remote_revision],
            )?;
            transaction.execute(
                r#"
                UPDATE sync_outbox
                SET acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP)
                WHERE operation_id = ?1
                "#,
                [operation_id],
            )?;
            transaction.commit()?;
            Ok(true)
        })
    }

    pub fn apply_remote_batch_and_advance_cursor(
        &self,
        service_id: &str,
        changes: &[SyncEntityRecord],
        server_revision: i64,
    ) -> StorageResult<usize> {
        if server_revision < 0
            || changes
                .iter()
                .any(|change| change.revision > server_revision)
        {
            return Err(StorageError::InvalidMutation(
                "remote batch revision range is invalid".into(),
            ));
        }
        self.with_connection(|connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            require_authoritative_bootstrap(&transaction)?;
            let state = require_remote(&transaction, service_id)?;
            if server_revision < state.last_pulled_revision {
                return Err(StorageError::InvalidMutation(
                    "remote cursor cannot move backwards".into(),
                ));
            }
            let mut applied = 0_usize;
            for change in changes {
                let current_local_revision = transaction
                    .query_row(
                        "SELECT revision FROM sync_entities WHERE entity_type = ?1 AND entity_id = ?2",
                        params![change.entity_type.as_str(), &change.entity_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()?
                    .unwrap_or(0);
                let operation_id = remote_operation_id(service_id, change);
                let request = SyncMutationRequest {
                    operation_id: operation_id.clone(),
                    change_set_id: operation_id,
                    device_id: format!("service:{service_id}"),
                    entity_type: change.entity_type,
                    entity_id: change.entity_id.clone(),
                    base_revision: current_local_revision,
                    order_position: change.order_position,
                    operation_type: if change.deleted_at.is_some() {
                        SyncOperationType::Delete
                    } else {
                        SyncOperationType::Upsert
                    },
                    payload: change.payload.clone(),
                };
                let result = apply_mutation_in_transaction(
                    &transaction,
                    &request,
                    MutationOrigin::Remote,
                )?;
                if !result.idempotent_replay {
                    applied += 1;
                }
                transaction.execute(
                    r#"
                    INSERT INTO sync_remote_entities (
                      service_id, entity_type, entity_id, remote_revision
                    ) VALUES (?1, ?2, ?3, ?4)
                    ON CONFLICT(service_id, entity_type, entity_id) DO UPDATE SET
                      remote_revision = excluded.remote_revision,
                      updated_at = CURRENT_TIMESTAMP
                    "#,
                    params![
                        service_id,
                        change.entity_type.as_str(),
                        &change.entity_id,
                        change.revision,
                    ],
                )?;
            }
            if applied > 0 {
                let reconstructed = reconstruct_with_connection(&transaction)?;
                write_materialized_snapshot(&transaction, &reconstructed)?;
            }
            transaction.execute(
                r#"
                UPDATE sync_remotes
                SET last_pulled_revision = ?2, updated_at = CURRENT_TIMESTAMP
                WHERE service_id = ?1
                "#,
                params![service_id, server_revision],
            )?;
            transaction.commit()?;
            Ok(applied)
        })
    }
}

fn prepare_operation(
    connection: &rusqlite::Connection,
    service_id: &str,
    operation: OutboxOperation,
) -> StorageResult<PreparedRemoteOperation> {
    let remote_base_revision = connection
        .query_row(
            r#"
            SELECT remote_revision FROM sync_remote_entities
            WHERE service_id = ?1 AND entity_type = ?2 AND entity_id = ?3
            "#,
            params![
                service_id,
                operation.entity_type.as_str(),
                &operation.entity_id
            ],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
    Ok(PreparedRemoteOperation {
        request: SyncMutationRequest {
            operation_id: operation.operation_id,
            change_set_id: operation.change_set_id,
            device_id: operation.device_id,
            entity_type: operation.entity_type,
            entity_id: operation.entity_id,
            base_revision: remote_base_revision,
            order_position: operation.order_position,
            operation_type: operation.operation_type,
            payload: operation.payload,
        },
        local_result_revision: operation.result_revision,
        attempt_count: operation.attempt_count,
    })
}

fn validate_remote_identity(service_id: &str, fingerprint: &str, host: &str) -> StorageResult<()> {
    if service_id.trim().is_empty() || !valid_https_host(host) {
        return Err(StorageError::InvalidMutation(
            "sync remote identity cannot be blank and its host must use HTTPS".into(),
        ));
    }
    if fingerprint.len() != 64 || !fingerprint.bytes().all(|value| value.is_ascii_hexdigit()) {
        return Err(StorageError::InvalidMutation(
            "sync remote certificate fingerprint must be 64 hexadecimal characters".into(),
        ));
    }
    Ok(())
}

fn valid_https_host(value: &str) -> bool {
    let value = value.trim();
    value.starts_with("https://") && value.len() > "https://".len()
}

fn load_remote_with_connection(
    connection: &rusqlite::Connection,
    service_id: &str,
) -> StorageResult<Option<SyncRemoteState>> {
    Ok(connection
        .query_row(
            r#"
            SELECT service_id, certificate_fingerprint_sha256,
                   last_known_host, last_pulled_revision
            FROM sync_remotes WHERE service_id = ?1
            "#,
            [service_id],
            sync_remote_from_row,
        )
        .optional()?)
}

fn sync_remote_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SyncRemoteState> {
    Ok(SyncRemoteState {
        service_id: row.get(0)?,
        certificate_fingerprint_sha256: row.get(1)?,
        last_known_host: row.get(2)?,
        last_pulled_revision: row.get(3)?,
    })
}

fn require_remote(
    connection: &rusqlite::Connection,
    service_id: &str,
) -> StorageResult<SyncRemoteState> {
    load_remote_with_connection(connection, service_id)?
        .ok_or_else(|| StorageError::InvalidMutation(format!("unknown sync remote {service_id}")))
}

fn remote_operation_id(service_id: &str, change: &SyncEntityRecord) -> String {
    let hash = Sha256::digest(
        format!(
            "greekgod://{service_id}/{}/{}/{}",
            change.entity_type.as_str(),
            change.entity_id,
            change.revision,
        )
        .as_bytes(),
    );
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SyncEntityType, DATABASE_FILENAME};
    use serde_json::json;
    use tempfile::tempdir;

    fn store() -> (tempfile::TempDir, NativeAppDataStore) {
        let directory = tempdir().expect("temporary remote sync database");
        let store = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME))
            .expect("native store");
        store
            .bootstrap_from_legacy_snapshot(
                &json!({
                    "version": 4,
                    "dailyEntries": [],
                    "workouts": [],
                    "templates": [],
                    "exerciseLibrary": [],
                    "settings": { "gymLocations": [] },
                    "coachNotes": {}
                }),
                "mobile:test",
            )
            .expect("bootstrap");
        store
            .register_sync_remote("service-a", &"ab".repeat(32), "https://192.168.1.10:47832")
            .expect("remote");
        (directory, store)
    }

    fn local_workout(operation_id: &str, base_revision: i64, reps: i64) -> SyncMutationRequest {
        SyncMutationRequest {
            operation_id: operation_id.into(),
            change_set_id: "90000000-0000-4000-8000-000000000001".into(),
            device_id: "mobile:test".into(),
            entity_type: SyncEntityType::Workout,
            entity_id: "workout-a".into(),
            base_revision,
            order_position: Some(0),
            operation_type: SyncOperationType::Upsert,
            payload: Some(json!({
                "id": "workout-a", "date": "2026-08-27", "templateId": "push",
                "templateCode": "A", "templateName": "PUSH",
                "exercises": [{ "id": "bench", "name": "Bench", "sets": [{ "id": "set-a", "reps": reps }] }]
            })),
        }
    }

    #[test]
    fn remote_base_revision_is_separate_from_local_sqlite_revision() {
        let (_directory, store) = store();
        let first = store
            .apply_local_mutation(&local_workout("91000000-0000-4000-8000-000000000001", 0, 6))
            .expect("local create");
        let prepared = store
            .prepare_remote_outbox("service-a", 1)
            .expect("prepared create");
        assert_eq!(prepared[0].request.base_revision, 0);
        store
            .acknowledge_remote_operation("service-a", &prepared[0].request.operation_id, 40)
            .expect("ack create");

        store
            .apply_local_mutation(&local_workout(
                "91000000-0000-4000-8000-000000000002",
                first.revision,
                7,
            ))
            .expect("local edit");
        let prepared = store
            .prepare_remote_outbox("service-a", 1)
            .expect("prepared edit");
        assert_eq!(prepared[0].request.base_revision, 40);
    }

    #[test]
    fn paired_sync_remotes_can_be_enumerated_without_secrets() {
        let (_directory, store) = store();
        store
            .register_sync_remote("service-b", &"cd".repeat(32), "https://192.168.1.11:39173")
            .expect("second remote");
        let remotes = store.list_sync_remotes().expect("remote list");
        assert_eq!(remotes.len(), 2);
        assert_eq!(remotes[0].service_id, "service-a");
        assert_eq!(remotes[1].service_id, "service-b");
    }

    #[test]
    fn sync_remote_hosts_fail_closed_without_https() {
        let (_directory, store) = store();
        assert!(store
            .register_sync_remote(
                "service-http",
                &"ef".repeat(32),
                "http://192.168.1.12:39173"
            )
            .is_err());
        assert!(store
            .update_sync_remote_host("service-a", "http://192.168.1.13:39173")
            .is_err());
    }

    #[test]
    fn current_client_round_trip_preserves_explicit_exercise_aliases_and_identity() {
        let source_directory = tempdir().expect("temporary source database");
        let source = NativeAppDataStore::new(source_directory.path().join(DATABASE_FILENAME))
            .expect("source store");
        source
            .bootstrap_from_legacy_snapshot(
                &json!({
                    "version": 4,
                    "dailyEntries": [],
                    "workouts": [{
                        "id": "workout-a",
                        "date": "2026-08-30",
                        "templateId": "push",
                        "templateCode": "A",
                        "templateName": "PUSH",
                        "exercises": [{
                            "id": "bench-snapshot",
                            "exerciseId": "bench-press",
                            "name": "Historical bench snapshot",
                            "sets": []
                        }]
                    }],
                    "templates": [{
                        "id": "push",
                        "code": "A",
                        "name": "PUSH",
                        "exercises": [{
                            "id": "bench-template",
                            "exerciseId": "bench-press",
                            "name": "Bench press",
                            "prescription": "3 x 5",
                            "defaultSets": 3
                        }]
                    }],
                    "exerciseLibrary": [{
                        "id": "bench-press",
                        "name": "Bench press",
                        "equipmentSensitive": false,
                        "aliases": ["Historical bench snapshot"]
                    }],
                    "settings": { "gymLocations": [] },
                    "coachNotes": {}
                }),
                "desktop:clean-source",
            )
            .expect("source bootstrap");

        let (_client_directory, client) = store();
        let (_late_client_directory, late_client) = store();
        let source_revision = source.current_sync_revision().expect("source revision");
        let source_changes = source.changes_since(0, 100).expect("source changes");
        client
            .apply_remote_batch_and_advance_cursor("service-a", &source_changes, source_revision)
            .expect("initial desktop to phone pull");
        late_client
            .apply_remote_batch_and_advance_cursor("service-a", &source_changes, source_revision)
            .expect("initial pull for a client that will synchronize later");

        let client_definition = client
            .load_sync_entity(SyncEntityType::ExerciseDefinition, "bench-press")
            .expect("load client definition")
            .expect("client definition exists");
        assert_eq!(
            client_definition.payload.as_ref().unwrap()["aliases"],
            json!(["Historical bench snapshot"])
        );
        let mut updated_payload = client_definition.payload.clone().unwrap();
        updated_payload["aliases"] = json!(["Historical bench snapshot", "Current mobile alias"]);
        let update = SyncMutationRequest {
            operation_id: "92000000-0000-4000-8000-000000000010".into(),
            change_set_id: "93000000-0000-4000-8000-000000000010".into(),
            device_id: "mobile:current-client".into(),
            entity_type: SyncEntityType::ExerciseDefinition,
            entity_id: "bench-press".into(),
            base_revision: client_definition.revision,
            order_position: client_definition.order_position,
            operation_type: SyncOperationType::Upsert,
            payload: Some(updated_payload.clone()),
        };
        client
            .apply_local_mutation(&update)
            .expect("current mobile client update");
        let prepared = client
            .prepare_remote_outbox("service-a", 10)
            .expect("prepare current client outbox");
        assert_eq!(prepared.len(), 1);
        assert_eq!(prepared[0].request.entity_id, "bench-press");
        assert_eq!(prepared[0].request.payload, Some(updated_payload));

        let source_result = source
            .apply_remote_mutation(&prepared[0].request)
            .expect("phone to desktop service push");
        client
            .acknowledge_remote_operation(
                "service-a",
                &prepared[0].request.operation_id,
                source_result.revision,
            )
            .expect("acknowledge phone push");
        let source_definition = source
            .load_sync_entity(SyncEntityType::ExerciseDefinition, "bench-press")
            .unwrap()
            .unwrap();
        assert_eq!(source_definition.entity_id, "bench-press");
        assert_eq!(
            source_definition.payload.as_ref().unwrap()["aliases"],
            json!(["Historical bench snapshot", "Current mobile alias"])
        );

        let return_changes = source
            .changes_since(source_revision, 100)
            .expect("desktop return changes");
        client
            .apply_remote_batch_and_advance_cursor(
                "service-a",
                &return_changes,
                source_result.revision,
            )
            .expect("return pull to current mobile client");
        let round_trip = client
            .load_authoritative_snapshot()
            .expect("round-trip snapshot");
        let definitions = round_trip.data["exerciseLibrary"].as_array().unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0]["id"], "bench-press");
        assert_eq!(
            definitions[0]["aliases"],
            json!(["Historical bench snapshot", "Current mobile alias"])
        );

        let current_definition = client
            .load_sync_entity(SyncEntityType::ExerciseDefinition, "bench-press")
            .unwrap()
            .unwrap();
        let mut cleared_payload = current_definition.payload.clone().unwrap();
        cleared_payload["aliases"] = json!([]);
        let clear = SyncMutationRequest {
            operation_id: "92000000-0000-4000-8000-000000000011".into(),
            change_set_id: "93000000-0000-4000-8000-000000000011".into(),
            device_id: "mobile:current-client".into(),
            entity_type: SyncEntityType::ExerciseDefinition,
            entity_id: "bench-press".into(),
            base_revision: current_definition.revision,
            order_position: current_definition.order_position,
            operation_type: SyncOperationType::Upsert,
            payload: Some(cleared_payload),
        };
        client
            .apply_local_mutation(&clear)
            .expect("current client explicit alias removal");
        let prepared_clear = client
            .prepare_remote_outbox("service-a", 10)
            .expect("prepare explicit clear");
        assert_eq!(prepared_clear.len(), 1);
        assert_eq!(
            prepared_clear[0].request.payload.as_ref().unwrap()["aliases"],
            json!([])
        );
        let clear_result = source
            .apply_remote_mutation(&prepared_clear[0].request)
            .expect("push explicit clear to source");
        assert_eq!(
            source
                .load_sync_entity(SyncEntityType::ExerciseDefinition, "bench-press")
                .unwrap()
                .unwrap()
                .payload
                .unwrap()["aliases"],
            json!([])
        );

        let clear_changes = source
            .changes_since(source_result.revision, 100)
            .expect("changes containing explicit clear");
        late_client
            .apply_remote_batch_and_advance_cursor(
                "service-a",
                &clear_changes,
                clear_result.revision,
            )
            .expect("late client pulls explicit clear");
        let late_definitions = late_client.load_authoritative_snapshot().unwrap().data
            ["exerciseLibrary"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(late_definitions.len(), 1);
        assert_eq!(late_definitions[0]["id"], "bench-press");
        assert_eq!(late_definitions[0]["aliases"], json!([]));
    }

    #[test]
    fn pulled_batch_and_cursor_commit_atomically_into_materialized_app_data() {
        let (_directory, store) = store();
        let change = SyncEntityRecord {
            entity_type: SyncEntityType::DailyEntry,
            entity_id: "2026-08-27".into(),
            revision: 12,
            created_revision: 12,
            created_at: "2026-08-27 10:00:00".into(),
            created_by_device_id: "desktop:test".into(),
            updated_at: "2026-08-27 10:00:00".into(),
            updated_by_device_id: "desktop:test".into(),
            deleted_at: None,
            order_position: Some(0),
            payload: Some(json!({ "id": "daily-a", "date": "2026-08-27", "protein": 195 })),
        };
        assert_eq!(
            store
                .apply_remote_batch_and_advance_cursor("service-a", &[change], 12)
                .expect("remote batch"),
            1
        );
        assert_eq!(
            store
                .load_sync_remote("service-a")
                .expect("remote")
                .unwrap()
                .last_pulled_revision,
            12
        );
        assert_eq!(
            store.load_authoritative_snapshot().expect("snapshot").data["dailyEntries"][0]
                ["protein"],
            195
        );
        assert!(store.pending_outbox(100).expect("outbox").is_empty());
    }

    #[test]
    fn invalid_pulled_batch_rolls_back_entities_mirror_and_cursor() {
        let (_directory, store) = store();
        let changes = vec![
            SyncEntityRecord {
                entity_type: SyncEntityType::Workout,
                entity_id: "remote-workout".into(),
                revision: 2,
                created_revision: 2,
                created_at: "now".into(),
                created_by_device_id: "desktop".into(),
                updated_at: "now".into(),
                updated_by_device_id: "desktop".into(),
                deleted_at: None,
                order_position: Some(0),
                payload: Some(
                    json!({ "id": "remote-workout", "date": "2026-08-27", "templateId": "push", "templateCode": "A", "templateName": "PUSH", "exercises": [] }),
                ),
            },
            SyncEntityRecord {
                entity_type: SyncEntityType::Settings,
                entity_id: "settings".into(),
                revision: 3,
                created_revision: 1,
                created_at: "now".into(),
                created_by_device_id: "desktop".into(),
                updated_at: "now".into(),
                updated_by_device_id: "desktop".into(),
                deleted_at: Some("now".into()),
                order_position: None,
                payload: None,
            },
        ];
        assert!(store
            .apply_remote_batch_and_advance_cursor("service-a", &changes, 3)
            .is_err());
        assert_eq!(
            store
                .load_sync_remote("service-a")
                .expect("remote")
                .unwrap()
                .last_pulled_revision,
            0
        );
        assert!(
            store.load_authoritative_snapshot().expect("snapshot").data["workouts"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
}
