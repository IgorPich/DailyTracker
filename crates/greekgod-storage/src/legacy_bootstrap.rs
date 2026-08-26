use crate::sync_repository::canonical_json;
use crate::{app_data_version, NativeAppDataStore, StorageError, StorageResult, SyncEntityType};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use uuid::Uuid;

const GYM_IDENTITY_NAMESPACE: &str = "greekgod:gym-sidecar:v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyBootstrapResult {
    pub source_hash: String,
    pub projected_entities: usize,
    pub global_revision: i64,
    pub already_complete: bool,
}

struct ProjectedEntity {
    entity_type: SyncEntityType,
    entity_id: String,
    payload: Value,
    order_position: Option<i64>,
    gym_sidecar: Option<GymSidecar>,
}

struct GymSidecar {
    legacy_name: String,
    legacy_ordinal: i64,
}

impl NativeAppDataStore {
    pub fn bootstrap_from_legacy_snapshot(
        &self,
        snapshot: &Value,
        device_id: &str,
    ) -> StorageResult<LegacyBootstrapResult> {
        if device_id.trim().is_empty() {
            return Err(StorageError::BootstrapMismatch(
                "bootstrap device ID cannot be blank".into(),
            ));
        }
        let data_version = app_data_version(snapshot)?;
        let projected = project_snapshot(snapshot)?;
        let source_hash = snapshot_hash(snapshot)?;
        let snapshot_payload = serde_json::to_string(snapshot)?;

        self.with_connection(|connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let (bootstrap_state, stored_hash): (String, Option<String>) = transaction.query_row(
                "SELECT bootstrap_state, bootstrap_source_hash FROM sync_meta WHERE singleton_id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;

            if bootstrap_state == "complete" {
                if stored_hash.as_deref() != Some(source_hash.as_str()) {
                    return Err(StorageError::BootstrapMismatch(
                        "a different Legacy snapshot was already projected".into(),
                    ));
                }
                let global_revision: i64 = transaction.query_row(
                    "SELECT global_revision FROM sync_meta WHERE singleton_id = 1",
                    [],
                    |row| row.get(0),
                )?;
                let projected_entities: i64 = transaction.query_row(
                    "SELECT COUNT(*) FROM sync_entities",
                    [],
                    |row| row.get(0),
                )?;
                return Ok(LegacyBootstrapResult {
                    source_hash,
                    projected_entities: projected_entities as usize,
                    global_revision,
                    already_complete: true,
                });
            }

            for table in [
                "sync_entities",
                "sync_entity_order",
                "sync_outbox",
                "applied_operations",
                "gym_sync_identities",
            ] {
                let count: i64 = transaction.query_row(
                    &format!("SELECT COUNT(*) FROM {table}"),
                    [],
                    |row| row.get(0),
                )?;
                if count != 0 {
                    return Err(StorageError::BootstrapMismatch(format!(
                        "pending bootstrap found {count} existing rows in {table}"
                    )));
                }
            }

            transaction.execute(
                r#"
                INSERT INTO app_data (singleton_id, data_version, payload_json)
                VALUES (1, ?1, ?2)
                ON CONFLICT(singleton_id) DO UPDATE SET
                  data_version = excluded.data_version,
                  payload_json = excluded.payload_json
                "#,
                params![data_version, &snapshot_payload],
            )?;

            let mut revision = 0_i64;
            for entity in &projected {
                revision += 1;
                let payload_json = serde_json::to_string(&entity.payload)?;
                transaction.execute(
                    r#"
                    INSERT INTO sync_entities (
                      entity_type,
                      entity_id,
                      revision,
                      created_revision,
                      created_by_device_id,
                      updated_by_device_id,
                      payload_json
                    )
                    VALUES (?1, ?2, ?3, ?3, ?4, ?4, ?5)
                    "#,
                    params![
                        entity.entity_type.as_str(),
                        &entity.entity_id,
                        revision,
                        device_id,
                        payload_json,
                    ],
                )?;
                if let Some(position) = entity.order_position {
                    transaction.execute(
                        r#"
                        INSERT INTO sync_entity_order (
                          entity_type,
                          entity_id,
                          position,
                          updated_revision
                        )
                        VALUES (?1, ?2, ?3, ?4)
                        "#,
                        params![
                            entity.entity_type.as_str(),
                            &entity.entity_id,
                            position,
                            revision,
                        ],
                    )?;
                }
                if let Some(sidecar) = &entity.gym_sidecar {
                    transaction.execute(
                        r#"
                        INSERT INTO gym_sync_identities (
                          gym_id,
                          legacy_name,
                          legacy_ordinal,
                          current_name
                        )
                        VALUES (?1, ?2, ?3, ?2)
                        "#,
                        params![
                            &entity.entity_id,
                            &sidecar.legacy_name,
                            sidecar.legacy_ordinal,
                        ],
                    )?;
                }
            }

            transaction.execute(
                r#"
                UPDATE sync_meta
                SET global_revision = ?1,
                    bootstrap_state = 'complete',
                    bootstrap_source_hash = ?2,
                    bootstrap_completed_at = CURRENT_TIMESTAMP
                WHERE singleton_id = 1
                "#,
                params![revision, &source_hash],
            )?;

            let reconstructed = reconstruct_with_connection(&transaction)?;
            if reconstructed != *snapshot {
                return Err(StorageError::BootstrapMismatch(
                    "entity projection does not reconstruct the exact Legacy snapshot".into(),
                ));
            }

            transaction.commit()?;
            Ok(LegacyBootstrapResult {
                source_hash,
                projected_entities: projected.len(),
                global_revision: revision,
                already_complete: false,
            })
        })
    }

    pub fn reconstruct_app_data_from_sync(&self) -> StorageResult<Value> {
        self.with_connection(|connection| {
            let bootstrap_state: String = connection.query_row(
                "SELECT bootstrap_state FROM sync_meta WHERE singleton_id = 1",
                [],
                |row| row.get(0),
            )?;
            if bootstrap_state != "complete" {
                return Err(StorageError::BootstrapMismatch(
                    "sync entity projection has not been bootstrapped".into(),
                ));
            }
            reconstruct_with_connection(connection)
        })
    }
}

fn project_snapshot(snapshot: &Value) -> StorageResult<Vec<ProjectedEntity>> {
    let root = snapshot.as_object().ok_or_else(|| {
        StorageError::BootstrapMismatch("Legacy AppData must be a JSON object".into())
    })?;
    let mut projected = Vec::new();
    project_array(
        root,
        "dailyEntries",
        "date",
        SyncEntityType::DailyEntry,
        &mut projected,
    )?;
    project_array(
        root,
        "workouts",
        "id",
        SyncEntityType::Workout,
        &mut projected,
    )?;
    project_array(
        root,
        "templates",
        "id",
        SyncEntityType::TrainingTemplate,
        &mut projected,
    )?;
    project_array(
        root,
        "exerciseLibrary",
        "id",
        SyncEntityType::ExerciseDefinition,
        &mut projected,
    )?;

    let settings = root
        .get("settings")
        .filter(|value| value.is_object())
        .ok_or_else(|| {
            StorageError::BootstrapMismatch("Legacy AppData.settings must be an object".into())
        })?
        .clone();
    projected.push(ProjectedEntity {
        entity_type: SyncEntityType::Settings,
        entity_id: "global".into(),
        payload: settings.clone(),
        order_position: None,
        gym_sidecar: None,
    });

    let gym_locations = settings
        .as_object()
        .and_then(|object| object.get("gymLocations"));
    if let Some(gym_locations) = gym_locations {
        let gym_locations = gym_locations.as_array().ok_or_else(|| {
            StorageError::BootstrapMismatch("settings.gymLocations must be an array".into())
        })?;
        let mut exact_names = HashSet::new();
        for (position, value) in gym_locations.iter().enumerate() {
            let name = value
                .as_str()
                .filter(|name| !name.trim().is_empty())
                .ok_or_else(|| {
                    StorageError::BootstrapMismatch(
                        "every settings.gymLocations item must be a non-blank string".into(),
                    )
                })?;
            if !exact_names.insert(name) {
                return Err(StorageError::BootstrapMismatch(format!(
                    "duplicate exact gym name cannot be assigned safely: {name}"
                )));
            }
            let gym_id = deterministic_gym_uuid(position, name);
            projected.push(ProjectedEntity {
                entity_type: SyncEntityType::Gym,
                entity_id: gym_id,
                payload: serde_json::json!({ "name": name }),
                order_position: Some(position as i64),
                gym_sidecar: Some(GymSidecar {
                    legacy_name: name.into(),
                    legacy_ordinal: position as i64,
                }),
            });
        }
    }

    let coach_notes = root
        .get("coachNotes")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            StorageError::BootstrapMismatch("Legacy AppData.coachNotes must be an object".into())
        })?;
    for (range_key, note) in coach_notes {
        let note = note.as_str().ok_or_else(|| {
            StorageError::BootstrapMismatch("every coach note must be a string".into())
        })?;
        projected.push(ProjectedEntity {
            entity_type: SyncEntityType::CoachNote,
            entity_id: range_key.clone(),
            payload: serde_json::json!({ "rangeKey": range_key, "note": note }),
            order_position: None,
            gym_sidecar: None,
        });
    }
    Ok(projected)
}

fn project_array(
    root: &Map<String, Value>,
    key: &str,
    identity_field: &str,
    entity_type: SyncEntityType,
    projected: &mut Vec<ProjectedEntity>,
) -> StorageResult<()> {
    let values = root.get(key).and_then(Value::as_array).ok_or_else(|| {
        StorageError::BootstrapMismatch(format!("Legacy AppData.{key} must be an array"))
    })?;
    let mut identities = HashSet::new();
    for (position, value) in values.iter().enumerate() {
        let entity_id = value
            .as_object()
            .and_then(|object| object.get(identity_field))
            .and_then(Value::as_str)
            .filter(|identity| !identity.trim().is_empty())
            .ok_or_else(|| {
                StorageError::BootstrapMismatch(format!(
                    "{key}[{position}].{identity_field} must be a non-blank string"
                ))
            })?;
        if !identities.insert(entity_id) {
            return Err(StorageError::BootstrapMismatch(format!(
                "duplicate {entity_type:?} sync identity {entity_id}"
            )));
        }
        projected.push(ProjectedEntity {
            entity_type,
            entity_id: entity_id.into(),
            payload: value.clone(),
            order_position: Some(position as i64),
            gym_sidecar: None,
        });
    }
    Ok(())
}

fn snapshot_hash(snapshot: &Value) -> StorageResult<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&canonical_json(snapshot))?)
    ))
}

fn deterministic_gym_uuid(position: usize, name: &str) -> String {
    let digest = Sha256::digest(format!("{GYM_IDENTITY_NAMESPACE}\0{position}\0{name}").as_bytes());
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes).hyphenated().to_string()
}

fn reconstruct_with_connection(connection: &Connection) -> StorageResult<Value> {
    let data_version: i64 = connection
        .query_row(
            "SELECT data_version FROM app_data WHERE singleton_id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| {
            StorageError::BootstrapMismatch("bootstrap AppData mirror is missing".into())
        })?;
    let daily_entries = active_payloads(connection, SyncEntityType::DailyEntry)?;
    let workouts = active_payloads(connection, SyncEntityType::Workout)?;
    let templates = active_payloads(connection, SyncEntityType::TrainingTemplate)?;
    let exercise_library = active_payloads(connection, SyncEntityType::ExerciseDefinition)?;
    let settings = active_payloads(connection, SyncEntityType::Settings)?;
    if settings.len() != 1 {
        return Err(StorageError::BootstrapMismatch(format!(
            "expected one active settings entity, found {}",
            settings.len()
        )));
    }

    let mut coach_notes = Map::new();
    for payload in active_payloads(connection, SyncEntityType::CoachNote)? {
        let object = payload.as_object().ok_or_else(|| {
            StorageError::InvalidData("coach note payload is not an object".into())
        })?;
        let range_key = object
            .get("rangeKey")
            .and_then(Value::as_str)
            .ok_or_else(|| StorageError::InvalidData("coach note rangeKey is missing".into()))?;
        let note = object
            .get("note")
            .and_then(Value::as_str)
            .ok_or_else(|| StorageError::InvalidData("coach note text is missing".into()))?;
        coach_notes.insert(range_key.into(), Value::String(note.into()));
    }

    let mut root = Map::new();
    root.insert("version".into(), Value::from(data_version));
    root.insert("dailyEntries".into(), Value::Array(daily_entries));
    root.insert("workouts".into(), Value::Array(workouts));
    root.insert("templates".into(), Value::Array(templates));
    root.insert("exerciseLibrary".into(), Value::Array(exercise_library));
    root.insert(
        "settings".into(),
        settings.into_iter().next().expect("one settings"),
    );
    root.insert("coachNotes".into(), Value::Object(coach_notes));
    Ok(Value::Object(root))
}

fn active_payloads(
    connection: &Connection,
    entity_type: SyncEntityType,
) -> StorageResult<Vec<Value>> {
    let mut statement = connection.prepare(
        r#"
        SELECT entities.payload_json
        FROM sync_entities AS entities
        LEFT JOIN sync_entity_order AS entity_order
          ON entity_order.entity_type = entities.entity_type
         AND entity_order.entity_id = entities.entity_id
        WHERE entities.entity_type = ?1
          AND entities.deleted_at IS NULL
        ORDER BY
          CASE WHEN entity_order.position IS NULL THEN 1 ELSE 0 END,
          entity_order.position ASC,
          entities.created_revision ASC
        "#,
    )?;
    let payloads = statement
        .query_map([entity_type.as_str()], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    payloads
        .into_iter()
        .map(|payload| Ok(serde_json::from_str(&payload)?))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DATABASE_FILENAME;
    use serde_json::json;
    use tempfile::tempdir;

    fn fixture() -> Value {
        json!({
            "version": 4,
            "dailyEntries": [
                { "id": "daily-z", "date": "2026-08-26", "weight": 82.35 },
                { "id": "daily-a", "date": "2026-08-25", "protein": 195 }
            ],
            "workouts": [
                {
                    "id": "workout-z",
                    "date": "2026-08-26",
                    "templateId": "template-a",
                    "templateCode": "A",
                    "templateName": "PUSH",
                    "gymLocation": "Klub Północ",
                    "exercises": [{
                        "id": "snapshot-z",
                        "exerciseId": "bench-press",
                        "name": "Historyczny Bench Press",
                        "sets": [
                            { "id": "set-z", "weight": 90.5, "reps": 6 },
                            { "id": "set-a", "weight": 85, "reps": 8 }
                        ]
                    }]
                },
                {
                    "id": "workout-a",
                    "date": "2026-08-24",
                    "templateId": "template-b",
                    "templateCode": "B",
                    "templateName": "PULL",
                    "exercises": []
                }
            ],
            "templates": [
                { "id": "template-b", "code": "B", "name": "PULL", "exercises": [] },
                { "id": "template-a", "code": "A", "name": "PUSH", "exercises": [] }
            ],
            "exerciseLibrary": [
                { "id": "row", "name": "Wiosło na wyciągu", "equipmentSensitive": true },
                { "id": "bench-press", "name": "Bench Press", "equipmentSensitive": false }
            ],
            "settings": {
                "phase": "Lean Gain",
                "calorieTarget": 3125,
                "proteinTarget": 187.5,
                "gymLocations": ["Klub Północ", "Klub Zachód"],
                "lastGymLocation": "Klub Północ",
                "trendThresholds": {
                    "lossBelow": -0.175,
                    "stableUpper": 0.075,
                    "slowGainUpper": 0.225
                }
            },
            "coachNotes": {
                "2026-08-z": "Notatka z polskimi znakami: ążźć",
                "2026-08-a": ""
            }
        })
    }

    fn store() -> (tempfile::TempDir, NativeAppDataStore) {
        let directory = tempdir().expect("temporary bootstrap directory");
        let store = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME))
            .expect("native store");
        (directory, store)
    }

    #[test]
    fn bootstrap_is_copy_only_idempotent_and_reconstructs_exact_array_order() {
        let (_directory, store) = store();
        let fixture = fixture();

        let first = store
            .bootstrap_from_legacy_snapshot(&fixture, "desktop-bootstrap")
            .expect("bootstrap");
        let repeated = store
            .bootstrap_from_legacy_snapshot(&fixture, "desktop-bootstrap")
            .expect("repeat bootstrap");

        assert!(!first.already_complete);
        assert!(repeated.already_complete);
        assert_eq!(first.projected_entities, 13);
        assert_eq!(first.global_revision, 13);
        assert_eq!(first.source_hash, repeated.source_hash);
        assert_eq!(
            store.reconstruct_app_data_from_sync().expect("reconstruct"),
            fixture
        );
        assert!(store.pending_outbox(100).expect("outbox").is_empty());
        store
            .with_connection(|connection| {
                let applied: i64 =
                    connection.query_row("SELECT COUNT(*) FROM applied_operations", [], |row| {
                        row.get(0)
                    })?;
                assert_eq!(applied, 0);
                Ok(())
            })
            .expect("verify copy-only bootstrap");
    }

    #[test]
    fn deterministic_gym_sidecars_are_stable_across_fresh_databases() {
        let (_first_directory, first) = store();
        let (_second_directory, second) = store();
        let fixture = fixture();
        first
            .bootstrap_from_legacy_snapshot(&fixture, "desktop-bootstrap")
            .expect("first bootstrap");
        second
            .bootstrap_from_legacy_snapshot(&fixture, "desktop-bootstrap")
            .expect("second bootstrap");

        let gym_ids = |store: &NativeAppDataStore| {
            store
                .changes_since(0, 100)
                .expect("changes")
                .into_iter()
                .filter(|entity| entity.entity_type == SyncEntityType::Gym)
                .map(|entity| entity.entity_id)
                .collect::<Vec<_>>()
        };
        assert_eq!(gym_ids(&first), gym_ids(&second));
        assert_eq!(gym_ids(&first).len(), 2);
    }

    #[test]
    fn duplicate_domain_identities_fail_before_any_projection_write() {
        let (_directory, store) = store();
        let mut duplicate_workout = fixture();
        duplicate_workout["workouts"][1]["id"] = Value::String("workout-z".into());

        assert!(matches!(
            store.bootstrap_from_legacy_snapshot(&duplicate_workout, "desktop-bootstrap"),
            Err(StorageError::BootstrapMismatch(_))
        ));
        assert_eq!(store.current_sync_revision().expect("revision"), 0);
        assert_eq!(store.load().expect("aggregate mirror"), None);

        let mut duplicate_day = fixture();
        duplicate_day["dailyEntries"][1]["date"] = Value::String("2026-08-26".into());
        assert!(matches!(
            store.bootstrap_from_legacy_snapshot(&duplicate_day, "desktop-bootstrap"),
            Err(StorageError::BootstrapMismatch(_))
        ));
        assert_eq!(store.current_sync_revision().expect("revision"), 0);
    }

    #[test]
    fn bootstrap_transaction_rolls_back_mirror_entities_and_meta_on_failure() {
        let (_directory, store) = store();
        store
            .with_connection(|connection| {
                connection.execute_batch(
                    r#"
                    CREATE TRIGGER fail_bootstrap_entity
                    BEFORE INSERT ON sync_entities
                    BEGIN
                      SELECT RAISE(ABORT, 'injected bootstrap failure');
                    END;
                    "#,
                )?;
                Ok(())
            })
            .expect("install failpoint");

        assert!(matches!(
            store.bootstrap_from_legacy_snapshot(&fixture(), "desktop-bootstrap"),
            Err(StorageError::Sqlite(_))
        ));
        assert_eq!(store.load().expect("aggregate mirror"), None);
        assert_eq!(store.current_sync_revision().expect("revision"), 0);
        store
            .with_connection(|connection| {
                let state: String = connection.query_row(
                    "SELECT bootstrap_state FROM sync_meta WHERE singleton_id = 1",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(state, "pending");
                Ok(())
            })
            .expect("verify pending state");
    }
}
