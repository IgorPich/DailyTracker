use crate::legacy_bootstrap::{
    project_snapshot, reconstruct_with_connection, write_materialized_snapshot, ProjectedEntity,
};
use crate::sync_repository::{
    apply_mutation_in_transaction, require_authoritative_bootstrap, MutationOrigin,
};
use crate::{
    app_data_version, NativeAppDataStore, StorageError, StorageResult, SyncEntityType,
    SyncMutationRequest, SyncOperationType,
};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthoritativeStorageStatus {
    pub bootstrapped: bool,
    pub global_revision: i64,
    pub materialized_revision: i64,
    pub data_version: Option<i64>,
    pub mirror_present: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthoritativeSnapshot {
    pub data: Value,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthoritativeReplaceResult {
    pub data: Value,
    pub revision: i64,
    pub applied_operations: usize,
}

#[derive(Clone)]
struct CurrentEntity {
    entity_type: SyncEntityType,
    entity_id: String,
    revision: i64,
    deleted: bool,
    payload: Option<Value>,
    order_position: Option<i64>,
}

#[derive(Clone)]
struct GymIdentity {
    gym_id: String,
    current_name: String,
    active: bool,
    order_position: Option<i64>,
}

impl NativeAppDataStore {
    pub fn authoritative_status(&self) -> StorageResult<AuthoritativeStorageStatus> {
        self.with_connection(|connection| {
            let (state, global_revision, materialized_revision, data_version): (
                String,
                i64,
                i64,
                Option<i64>,
            ) = connection.query_row(
                r#"
                SELECT bootstrap_state, global_revision, materialized_revision,
                       authoritative_data_version
                FROM sync_meta
                WHERE singleton_id = 1
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?;
            let mirror_present = connection
                .query_row("SELECT 1 FROM app_data WHERE singleton_id = 1", [], |_| {
                    Ok(())
                })
                .optional()?
                .is_some();
            Ok(AuthoritativeStorageStatus {
                bootstrapped: state == "complete",
                global_revision,
                materialized_revision,
                data_version,
                mirror_present,
            })
        })
    }

    pub fn load_authoritative_snapshot(&self) -> StorageResult<AuthoritativeSnapshot> {
        self.with_connection(|connection| {
            let (state, global_revision, materialized_revision): (String, i64, i64) = connection
                .query_row(
                    r#"
                    SELECT bootstrap_state, global_revision, materialized_revision
                    FROM sync_meta
                    WHERE singleton_id = 1
                    "#,
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )?;
            if state != "complete" {
                return Err(StorageError::BootstrapMismatch(
                    "authoritative snapshot is unavailable before bootstrap".into(),
                ));
            }
            let reconstructed = reconstruct_with_connection(connection)?;
            verify_materialized_snapshot(
                connection,
                &reconstructed,
                global_revision,
                materialized_revision,
            )?;
            Ok(AuthoritativeSnapshot {
                data: reconstructed,
                revision: global_revision,
            })
        })
    }

    pub fn replace_authoritative_snapshot(
        &self,
        desired: &Value,
        device_id: &str,
        expected_revision: i64,
    ) -> StorageResult<AuthoritativeReplaceResult> {
        if device_id.trim().is_empty() {
            return Err(StorageError::InvalidMutation(
                "authoritative snapshot device ID cannot be blank".into(),
            ));
        }
        if expected_revision < 0 {
            return Err(StorageError::InvalidMutation(
                "expected authoritative revision cannot be negative".into(),
            ));
        }
        let desired_version = app_data_version(desired)?;
        let projected = project_snapshot(desired)?;

        self.with_connection(|connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            require_authoritative_bootstrap(&transaction)?;
            let (current_revision, authoritative_version): (i64, i64) = transaction.query_row(
                r#"
                SELECT global_revision, authoritative_data_version
                FROM sync_meta
                WHERE singleton_id = 1
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if current_revision != expected_revision {
                return Err(StorageError::Conflict {
                    entity_type: "snapshot".into(),
                    entity_id: "global".into(),
                    base_revision: expected_revision,
                    current_revision,
                });
            }
            if desired_version != authoritative_version {
                return Err(StorageError::InvalidData(format!(
                    "AppData version {desired_version} differs from authoritative version {authoritative_version}"
                )));
            }

            let current = load_current_entities(&transaction)?;
            let desired_entities = preserve_gym_identities(&transaction, projected)?;
            let desired_keys = desired_entities
                .iter()
                .map(entity_key)
                .collect::<HashSet<_>>();
            let change_set_id = Uuid::new_v4().hyphenated().to_string();
            let mut applied_operations = 0_usize;

            for entity in &desired_entities {
                let key = entity_key(entity);
                let existing = current.get(&key);
                let unchanged = existing.is_some_and(|existing| {
                    !existing.deleted
                        && existing.payload.as_ref() == Some(&entity.payload)
                        && existing.order_position == entity.order_position
                });
                if unchanged {
                    continue;
                }
                let request = SyncMutationRequest {
                    operation_id: Uuid::new_v4().hyphenated().to_string(),
                    change_set_id: change_set_id.clone(),
                    device_id: device_id.into(),
                    entity_type: entity.entity_type,
                    entity_id: entity.entity_id.clone(),
                    base_revision: existing.map_or(0, |value| value.revision),
                    order_position: entity.order_position,
                    operation_type: SyncOperationType::Upsert,
                    payload: Some(entity.payload.clone()),
                };
                apply_mutation_in_transaction(&transaction, &request, MutationOrigin::Local)?;
                applied_operations += 1;
            }

            for existing in current.values() {
                let key = (existing.entity_type.as_str().to_owned(), existing.entity_id.clone());
                if existing.deleted || desired_keys.contains(&key) {
                    continue;
                }
                let request = SyncMutationRequest {
                    operation_id: Uuid::new_v4().hyphenated().to_string(),
                    change_set_id: change_set_id.clone(),
                    device_id: device_id.into(),
                    entity_type: existing.entity_type,
                    entity_id: existing.entity_id.clone(),
                    base_revision: existing.revision,
                    order_position: None,
                    operation_type: SyncOperationType::Delete,
                    payload: None,
                };
                apply_mutation_in_transaction(&transaction, &request, MutationOrigin::Local)?;
                applied_operations += 1;
            }

            let reconstructed = reconstruct_with_connection(&transaction)?;
            if reconstructed != *desired {
                return Err(StorageError::InvalidData(
                    "authoritative entity reconciliation did not reproduce the requested AppData"
                        .into(),
                ));
            }
            let revision = write_materialized_snapshot(&transaction, &reconstructed)?;
            transaction.commit()?;
            Ok(AuthoritativeReplaceResult {
                data: reconstructed,
                revision,
                applied_operations,
            })
        })
    }
}

fn entity_key(entity: &ProjectedEntity) -> (String, String) {
    (
        entity.entity_type.as_str().to_owned(),
        entity.entity_id.clone(),
    )
}

fn load_current_entities(
    transaction: &Transaction<'_>,
) -> StorageResult<BTreeMap<(String, String), CurrentEntity>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT entities.entity_type, entities.entity_id, entities.revision,
               entities.deleted_at IS NOT NULL, entities.payload_json,
               entity_order.position
        FROM sync_entities AS entities
        LEFT JOIN sync_entity_order AS entity_order
          ON entity_order.entity_type = entities.entity_type
         AND entity_order.entity_id = entities.entity_id
        ORDER BY entities.entity_type, entities.entity_id
        "#,
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<i64>>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut entities = BTreeMap::new();
    for (entity_type, entity_id, revision, deleted, payload, order_position) in rows {
        let parsed_type = sync_entity_type_from_database(&entity_type)?;
        let payload = payload
            .map(|payload| serde_json::from_str(&payload))
            .transpose()?;
        entities.insert(
            (entity_type, entity_id.clone()),
            CurrentEntity {
                entity_type: parsed_type,
                entity_id,
                revision,
                deleted,
                payload,
                order_position,
            },
        );
    }
    Ok(entities)
}

fn sync_entity_type_from_database(value: &str) -> StorageResult<SyncEntityType> {
    match value {
        "workout" => Ok(SyncEntityType::Workout),
        "daily_entry" => Ok(SyncEntityType::DailyEntry),
        "training_template" => Ok(SyncEntityType::TrainingTemplate),
        "gym" => Ok(SyncEntityType::Gym),
        "exercise_definition" => Ok(SyncEntityType::ExerciseDefinition),
        "settings" => Ok(SyncEntityType::Settings),
        "coach_note" => Ok(SyncEntityType::CoachNote),
        _ => Err(StorageError::InvalidData(format!(
            "unknown sync entity type {value}"
        ))),
    }
}

fn preserve_gym_identities(
    transaction: &Transaction<'_>,
    projected: Vec<ProjectedEntity>,
) -> StorageResult<Vec<ProjectedEntity>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT identities.gym_id, identities.current_name,
               entities.deleted_at IS NULL, entity_order.position
        FROM gym_sync_identities AS identities
        JOIN sync_entities AS entities
          ON entities.entity_type = 'gym' AND entities.entity_id = identities.gym_id
        LEFT JOIN sync_entity_order AS entity_order
          ON entity_order.entity_type = 'gym' AND entity_order.entity_id = identities.gym_id
        ORDER BY identities.legacy_ordinal, identities.gym_id
        "#,
    )?;
    let identities = statement
        .query_map([], |row| {
            Ok(GymIdentity {
                gym_id: row.get(0)?,
                current_name: row.get(1)?,
                active: row.get(2)?,
                order_position: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    let mut used = HashSet::new();
    let mut resolved = Vec::with_capacity(projected.len());
    for mut entity in projected {
        if entity.entity_type != SyncEntityType::Gym {
            resolved.push(entity);
            continue;
        }
        let name = entity
            .payload
            .as_object()
            .and_then(|payload| payload.get("name"))
            .and_then(Value::as_str)
            .expect("projected gym name");
        let by_name = identities
            .iter()
            .find(|identity| !used.contains(&identity.gym_id) && identity.current_name == name);
        let by_position = identities.iter().find(|identity| {
            identity.active
                && !used.contains(&identity.gym_id)
                && identity.order_position == entity.order_position
        });
        entity.entity_id = by_name
            .or(by_position)
            .map(|identity| identity.gym_id.clone())
            .unwrap_or_else(|| Uuid::new_v4().hyphenated().to_string());
        used.insert(entity.entity_id.clone());
        resolved.push(entity);
    }
    Ok(resolved)
}

fn verify_materialized_snapshot(
    connection: &rusqlite::Connection,
    reconstructed: &Value,
    global_revision: i64,
    materialized_revision: i64,
) -> StorageResult<()> {
    if materialized_revision != global_revision {
        return Err(StorageError::InvalidData(format!(
            "materialized AppData revision {materialized_revision} lags authoritative revision {global_revision}"
        )));
    }
    let (data_version, payload): (i64, String) = connection
        .query_row(
            "SELECT data_version, payload_json FROM app_data WHERE singleton_id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| {
            StorageError::InvalidData("materialized AppData mirror is missing".into())
        })?;
    let mirror: Value = serde_json::from_str(&payload)?;
    if app_data_version(&mirror)? != data_version || mirror != *reconstructed {
        return Err(StorageError::InvalidData(
            "materialized AppData mirror differs from authoritative entities".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SyncMutationRequest, DATABASE_FILENAME};
    use serde_json::json;
    use tempfile::tempdir;

    fn fixture() -> Value {
        json!({
            "version": 4,
            "dailyEntries": [
                { "id": "daily-a", "date": "2026-08-25", "weight": 82.35, "protein": 195 },
                { "id": "daily-b", "date": "2026-08-26", "carbs": 321.5 }
            ],
            "workouts": [{
                "id": "workout-a",
                "date": "2026-08-26",
                "templateId": "template-a",
                "templateCode": "A",
                "templateName": "PUSH",
                "gymLocation": "Klub Północ",
                "durationMinutes": 67,
                "exercises": [{
                    "id": "snapshot-a",
                    "exerciseId": "bench-press",
                    "name": "Bench Press snapshot",
                    "sets": [
                        { "id": "set-b", "weight": 90.5, "reps": 6 },
                        { "id": "set-a", "weight": 85, "reps": 8 }
                    ]
                }]
            }],
            "templates": [{
                "id": "template-a",
                "code": "A",
                "name": "PUSH",
                "exercises": []
            }],
            "exerciseLibrary": [{
                "id": "bench-press",
                "name": "Bench Press",
                "equipmentSensitive": true
            }],
            "settings": {
                "phase": "Maintenance",
                "calorieTarget": 2800,
                "gymLocations": ["Klub Północ", "Klub Południe"],
                "lastGymLocation": "Klub Północ",
                "trendThresholds": {
                    "lossBelow": -0.15,
                    "stableUpper": 0.05,
                    "slowGainUpper": 0.2
                }
            },
            "coachNotes": { "2026-W35": "Bez zmian." }
        })
    }

    fn bootstrapped_store() -> (tempfile::TempDir, NativeAppDataStore, i64) {
        let directory = tempdir().expect("temporary authority directory");
        let store = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME))
            .expect("native store");
        let bootstrap = store
            .bootstrap_from_legacy_snapshot(&fixture(), "desktop-bootstrap")
            .expect("bootstrap fixture");
        (directory, store, bootstrap.global_revision)
    }

    fn gym_id(store: &NativeAppDataStore, name: &str) -> String {
        store
            .with_connection(|connection| {
                Ok(connection.query_row(
                    "SELECT gym_id FROM gym_sync_identities WHERE current_name = ?1",
                    [name],
                    |row| row.get(0),
                )?)
            })
            .expect("gym ID")
    }

    #[test]
    fn bootstrap_entities_are_the_verified_source_of_truth() {
        let (_directory, store, revision) = bootstrapped_store();
        let status = store.authoritative_status().expect("status");
        let loaded = store.load_authoritative_snapshot().expect("load authority");

        assert!(status.bootstrapped);
        assert!(status.mirror_present);
        assert_eq!(status.data_version, Some(4));
        assert_eq!(status.global_revision, revision);
        assert_eq!(status.materialized_revision, revision);
        assert_eq!(loaded.data, fixture());
        assert_eq!(loaded.revision, revision);
    }

    #[test]
    fn snapshot_reconciliation_preserves_domain_identity_order_and_optional_values() {
        let (_directory, store, revision) = bootstrapped_store();
        let gym_before = gym_id(&store, "Klub Północ");
        let workout_before = store
            .load_sync_entity(SyncEntityType::Workout, "workout-a")
            .expect("load workout")
            .expect("workout");
        let mut desired = fixture();
        desired["dailyEntries"][0]["id"] = json!("replacement-ui-id");
        desired["dailyEntries"][0]["weight"] = json!(82.4);
        desired["workouts"][0]["gymLocation"] = json!("Klub Centralny");
        desired["workouts"][0]["exercises"][0]["sets"][0]["reps"] = json!(7);
        desired["settings"]["gymLocations"][0] = json!("Klub Centralny");
        desired["settings"]["lastGymLocation"] = json!("Klub Centralny");
        desired["settings"]
            .as_object_mut()
            .expect("settings")
            .remove("calorieTarget");

        let replaced = store
            .replace_authoritative_snapshot(&desired, "desktop-test", revision)
            .expect("replace authority");
        let loaded = store
            .load_authoritative_snapshot()
            .expect("reload authority");
        let gym_after = gym_id(&store, "Klub Centralny");
        let workout_after = store
            .load_sync_entity(SyncEntityType::Workout, "workout-a")
            .expect("load workout")
            .expect("workout");

        assert!(replaced.applied_operations >= 4);
        assert_eq!(loaded.data, desired);
        assert_eq!(loaded.revision, replaced.revision);
        assert_eq!(
            gym_after, gym_before,
            "gym rename must preserve the sidecar ID"
        );
        assert_eq!(
            workout_after.created_revision,
            workout_before.created_revision
        );
        assert!(workout_after.revision > workout_before.revision);
        store
            .with_connection(|connection| {
                let daily_count: i64 = connection.query_row(
                    "SELECT COUNT(*) FROM sync_entities WHERE entity_type = 'daily_entry' AND deleted_at IS NULL",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(daily_count, 2, "one active DailyEntry per date");
                Ok(())
            })
            .expect("daily identity count");
    }

    #[test]
    fn workout_delete_creates_tombstone_and_stale_resurrection_is_rejected() {
        let (_directory, store, revision) = bootstrapped_store();
        let workout_revision = store
            .load_sync_entity(SyncEntityType::Workout, "workout-a")
            .expect("load workout")
            .expect("workout")
            .revision;
        let mut desired = fixture();
        desired["workouts"] = json!([]);
        let deleted = store
            .replace_authoritative_snapshot(&desired, "desktop-test", revision)
            .expect("delete workout");
        let tombstone = store
            .load_sync_entity(SyncEntityType::Workout, "workout-a")
            .expect("load tombstone")
            .expect("tombstone");
        assert!(tombstone.deleted_at.is_some());
        assert!(tombstone.payload.is_none());
        assert_eq!(
            store.load_authoritative_snapshot().expect("load").data,
            desired
        );

        let stale = SyncMutationRequest {
            operation_id: "50000000-0000-4000-8000-000000000001".into(),
            change_set_id: "60000000-0000-4000-8000-000000000001".into(),
            device_id: "mobile-test".into(),
            entity_type: SyncEntityType::Workout,
            entity_id: "workout-a".into(),
            base_revision: workout_revision,
            order_position: Some(0),
            operation_type: SyncOperationType::Upsert,
            payload: Some(fixture()["workouts"][0].clone()),
        };
        assert!(matches!(
            store.apply_remote_mutation(&stale),
            Err(StorageError::Conflict {
                current_revision,
                ..
            }) if current_revision == tombstone.revision
        ));
        assert_eq!(
            store.current_sync_revision().expect("revision"),
            deleted.revision
        );
    }

    #[test]
    fn remote_entity_mutation_and_materialized_mirror_commit_together() {
        let (_directory, store, _revision) = bootstrapped_store();
        let current = store
            .load_sync_entity(SyncEntityType::Workout, "workout-a")
            .expect("load workout")
            .expect("workout");
        let mut payload = current.payload.expect("payload");
        payload["durationMinutes"] = json!(71);
        let request = SyncMutationRequest {
            operation_id: "50000000-0000-4000-8000-000000000002".into(),
            change_set_id: "60000000-0000-4000-8000-000000000002".into(),
            device_id: "mobile-test".into(),
            entity_type: SyncEntityType::Workout,
            entity_id: "workout-a".into(),
            base_revision: current.revision,
            order_position: Some(0),
            operation_type: SyncOperationType::Upsert,
            payload: Some(payload),
        };
        let result = store
            .apply_remote_mutation(&request)
            .expect("remote update");
        let loaded = store.load_authoritative_snapshot().expect("load authority");

        assert_eq!(loaded.revision, result.revision);
        assert_eq!(loaded.data["workouts"][0]["durationMinutes"], 71);
        assert_eq!(store.load().expect("load mirror"), Some(loaded.data));
    }

    #[test]
    fn stale_snapshot_revision_cannot_overwrite_newer_authority() {
        let (_directory, store, revision) = bootstrapped_store();
        let mut first = fixture();
        first["settings"]["phase"] = json!("Slow gain");
        let first_result = store
            .replace_authoritative_snapshot(&first, "desktop-test", revision)
            .expect("first update");
        let mut stale = fixture();
        stale["settings"]["phase"] = json!("Reduction");

        assert!(matches!(
            store.replace_authoritative_snapshot(&stale, "desktop-test", revision),
            Err(StorageError::Conflict {
                current_revision,
                ..
            }) if current_revision == first_result.revision
        ));
        assert_eq!(
            store.load_authoritative_snapshot().expect("load").data,
            first
        );
    }

    #[test]
    fn mirror_write_failpoint_rolls_back_entities_outbox_and_revision() {
        assert_reconciliation_failpoint_rolls_back(
            r#"
            CREATE TRIGGER fail_materialized_app_data
            BEFORE UPDATE ON app_data
            BEGIN
              SELECT RAISE(ABORT, 'injected mirror failure');
            END;
            "#,
        );
    }

    #[test]
    fn materialized_revision_failpoint_rolls_back_mirror_entities_and_outbox() {
        assert_reconciliation_failpoint_rolls_back(
            r#"
            CREATE TRIGGER fail_materialized_revision
            BEFORE UPDATE OF materialized_revision ON sync_meta
            WHEN NEW.materialized_revision > OLD.materialized_revision
            BEGIN
              SELECT RAISE(ABORT, 'injected materialized revision failure');
            END;
            "#,
        );
    }

    fn assert_reconciliation_failpoint_rolls_back(trigger: &str) {
        let (_directory, store, revision) = bootstrapped_store();
        let before = store.load_authoritative_snapshot().expect("before");
        let outbox_before = store.pending_outbox(100).expect("outbox before").len();
        store
            .with_connection(|connection| {
                connection.execute_batch(trigger)?;
                Ok(())
            })
            .expect("install failpoint");
        let mut desired = fixture();
        desired["workouts"][0]["durationMinutes"] = json!(99);

        assert!(matches!(
            store.replace_authoritative_snapshot(&desired, "desktop-test", revision),
            Err(StorageError::Sqlite(_))
        ));
        assert_eq!(store.load_authoritative_snapshot().expect("after"), before);
        assert_eq!(store.current_sync_revision().expect("revision"), revision);
        assert_eq!(
            store.pending_outbox(100).expect("outbox after").len(),
            outbox_before
        );
    }
}
