use crate::{NativeAppDataStore, StorageError, StorageResult};
use rusqlite::{params, OptionalExtension, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncEntityType {
    Workout,
    DailyEntry,
    TrainingTemplate,
    Gym,
    ExerciseDefinition,
    Settings,
    CoachNote,
}

impl SyncEntityType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Workout => "workout",
            Self::DailyEntry => "daily_entry",
            Self::TrainingTemplate => "training_template",
            Self::Gym => "gym",
            Self::ExerciseDefinition => "exercise_definition",
            Self::Settings => "settings",
            Self::CoachNote => "coach_note",
        }
    }

    fn from_database(value: &str) -> StorageResult<Self> {
        match value {
            "workout" => Ok(Self::Workout),
            "daily_entry" => Ok(Self::DailyEntry),
            "training_template" => Ok(Self::TrainingTemplate),
            "gym" => Ok(Self::Gym),
            "exercise_definition" => Ok(Self::ExerciseDefinition),
            "settings" => Ok(Self::Settings),
            "coach_note" => Ok(Self::CoachNote),
            _ => Err(StorageError::InvalidData(format!(
                "unknown sync entity type {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncOperationType {
    Upsert,
    Delete,
}

impl SyncOperationType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Upsert => "upsert",
            Self::Delete => "delete",
        }
    }

    fn from_database(value: &str) -> StorageResult<Self> {
        match value {
            "upsert" => Ok(Self::Upsert),
            "delete" => Ok(Self::Delete),
            _ => Err(StorageError::InvalidData(format!(
                "unknown sync operation type {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncMutationRequest {
    pub operation_id: String,
    pub change_set_id: String,
    pub device_id: String,
    pub entity_type: SyncEntityType,
    pub entity_id: String,
    pub base_revision: i64,
    pub order_position: Option<i64>,
    pub operation_type: SyncOperationType,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncMutationResult {
    pub operation_id: String,
    pub entity_type: SyncEntityType,
    pub entity_id: String,
    pub revision: i64,
    pub deleted: bool,
    pub idempotent_replay: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncEntityRecord {
    pub entity_type: SyncEntityType,
    pub entity_id: String,
    pub revision: i64,
    pub created_revision: i64,
    pub created_at: String,
    pub created_by_device_id: String,
    pub updated_at: String,
    pub updated_by_device_id: String,
    pub deleted_at: Option<String>,
    pub order_position: Option<i64>,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutboxOperation {
    pub operation_id: String,
    pub change_set_id: String,
    pub device_id: String,
    pub entity_type: SyncEntityType,
    pub entity_id: String,
    pub base_revision: i64,
    pub result_revision: i64,
    pub operation_type: SyncOperationType,
    pub order_position: Option<i64>,
    pub payload: Option<Value>,
    pub request_hash: String,
    pub created_at: String,
    pub attempt_count: i64,
    pub last_attempt_at: Option<String>,
    pub acknowledged_at: Option<String>,
}

#[derive(Clone, Copy)]
enum MutationOrigin {
    Local,
    Remote,
}

impl MutationOrigin {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Remote => "remote",
        }
    }
}

struct RawEntityRow {
    entity_type: String,
    entity_id: String,
    revision: i64,
    created_revision: i64,
    created_at: String,
    created_by_device_id: String,
    updated_at: String,
    updated_by_device_id: String,
    deleted_at: Option<String>,
    payload_json: Option<String>,
    order_position: Option<i64>,
}

impl RawEntityRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            entity_type: row.get(0)?,
            entity_id: row.get(1)?,
            revision: row.get(2)?,
            created_revision: row.get(3)?,
            created_at: row.get(4)?,
            created_by_device_id: row.get(5)?,
            updated_at: row.get(6)?,
            updated_by_device_id: row.get(7)?,
            deleted_at: row.get(8)?,
            payload_json: row.get(9)?,
            order_position: row.get(10)?,
        })
    }

    fn into_record(self) -> StorageResult<SyncEntityRecord> {
        Ok(SyncEntityRecord {
            entity_type: SyncEntityType::from_database(&self.entity_type)?,
            entity_id: self.entity_id,
            revision: self.revision,
            created_revision: self.created_revision,
            created_at: self.created_at,
            created_by_device_id: self.created_by_device_id,
            updated_at: self.updated_at,
            updated_by_device_id: self.updated_by_device_id,
            deleted_at: self.deleted_at,
            order_position: self.order_position,
            payload: self
                .payload_json
                .map(|payload| serde_json::from_str(&payload))
                .transpose()?,
        })
    }
}

struct RawOutboxRow {
    operation_id: String,
    change_set_id: String,
    device_id: String,
    entity_type: String,
    entity_id: String,
    base_revision: i64,
    result_revision: i64,
    operation_type: String,
    payload_json: Option<String>,
    order_position: Option<i64>,
    request_hash: String,
    created_at: String,
    attempt_count: i64,
    last_attempt_at: Option<String>,
    acknowledged_at: Option<String>,
}

impl RawOutboxRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            operation_id: row.get(0)?,
            change_set_id: row.get(1)?,
            device_id: row.get(2)?,
            entity_type: row.get(3)?,
            entity_id: row.get(4)?,
            base_revision: row.get(5)?,
            result_revision: row.get(6)?,
            operation_type: row.get(7)?,
            payload_json: row.get(8)?,
            order_position: row.get(9)?,
            request_hash: row.get(10)?,
            created_at: row.get(11)?,
            attempt_count: row.get(12)?,
            last_attempt_at: row.get(13)?,
            acknowledged_at: row.get(14)?,
        })
    }

    fn into_operation(self) -> StorageResult<OutboxOperation> {
        Ok(OutboxOperation {
            operation_id: self.operation_id,
            change_set_id: self.change_set_id,
            device_id: self.device_id,
            entity_type: SyncEntityType::from_database(&self.entity_type)?,
            entity_id: self.entity_id,
            base_revision: self.base_revision,
            result_revision: self.result_revision,
            operation_type: SyncOperationType::from_database(&self.operation_type)?,
            order_position: self.order_position,
            payload: self
                .payload_json
                .map(|payload| serde_json::from_str(&payload))
                .transpose()?,
            request_hash: self.request_hash,
            created_at: self.created_at,
            attempt_count: self.attempt_count,
            last_attempt_at: self.last_attempt_at,
            acknowledged_at: self.acknowledged_at,
        })
    }
}

impl NativeAppDataStore {
    pub fn apply_local_mutation(
        &self,
        request: &SyncMutationRequest,
    ) -> StorageResult<SyncMutationResult> {
        self.apply_mutation(request, MutationOrigin::Local)
    }

    pub fn apply_remote_mutation(
        &self,
        request: &SyncMutationRequest,
    ) -> StorageResult<SyncMutationResult> {
        self.apply_mutation(request, MutationOrigin::Remote)
    }

    fn apply_mutation(
        &self,
        request: &SyncMutationRequest,
        origin: MutationOrigin,
    ) -> StorageResult<SyncMutationResult> {
        validate_request(request)?;
        let request_hash = request_hash(request, origin)?;
        let payload_json = request
            .payload
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        self.with_connection(|connection| {
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;

            if let Some((stored_hash, result_json)) = transaction
                .query_row(
                    "SELECT request_hash, result_json FROM applied_operations WHERE operation_id = ?1",
                    [&request.operation_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?
            {
                if stored_hash != request_hash {
                    return Err(StorageError::OperationIdReuse(request.operation_id.clone()));
                }
                let mut result: SyncMutationResult = serde_json::from_str(&result_json)?;
                result.idempotent_replay = true;
                return Ok(result);
            }

            let current_revision = transaction
                .query_row(
                    "SELECT revision FROM sync_entities WHERE entity_type = ?1 AND entity_id = ?2",
                    params![request.entity_type.as_str(), &request.entity_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .unwrap_or(0);
            if request.base_revision != current_revision {
                return Err(StorageError::Conflict {
                    entity_type: request.entity_type.as_str().into(),
                    entity_id: request.entity_id.clone(),
                    base_revision: request.base_revision,
                    current_revision,
                });
            }

            let revision: i64 = transaction.query_row(
                r#"
                UPDATE sync_meta
                SET global_revision = global_revision + 1
                WHERE singleton_id = 1
                RETURNING global_revision
                "#,
                [],
                |row| row.get(0),
            )?;

            match request.operation_type {
                SyncOperationType::Upsert => {
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
                        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                          revision = excluded.revision,
                          updated_at = CURRENT_TIMESTAMP,
                          updated_by_device_id = excluded.updated_by_device_id,
                          deleted_at = NULL,
                          payload_json = excluded.payload_json
                        "#,
                        params![
                            request.entity_type.as_str(),
                            &request.entity_id,
                            revision,
                            &request.device_id,
                            payload_json.as_deref(),
                        ],
                    )?;
                }
                SyncOperationType::Delete => {
                    transaction.execute(
                        r#"
                        INSERT INTO sync_entities (
                          entity_type,
                          entity_id,
                          revision,
                          created_revision,
                          created_by_device_id,
                          updated_by_device_id,
                          deleted_at,
                          payload_json
                        )
                        VALUES (?1, ?2, ?3, ?3, ?4, ?4, CURRENT_TIMESTAMP, NULL)
                        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                          revision = excluded.revision,
                          updated_at = CURRENT_TIMESTAMP,
                          updated_by_device_id = excluded.updated_by_device_id,
                          deleted_at = CURRENT_TIMESTAMP,
                          payload_json = NULL
                        "#,
                        params![
                            request.entity_type.as_str(),
                            &request.entity_id,
                            revision,
                            &request.device_id,
                        ],
                    )?;
                }
            }

            if request.operation_type == SyncOperationType::Upsert {
                if let Some(position) = request.order_position {
                    transaction.execute(
                        r#"
                        INSERT INTO sync_entity_order (
                          entity_type,
                          entity_id,
                          position,
                          updated_revision
                        )
                        VALUES (?1, ?2, ?3, ?4)
                        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                          position = excluded.position,
                          updated_revision = excluded.updated_revision
                        "#,
                        params![
                            request.entity_type.as_str(),
                            &request.entity_id,
                            position,
                            revision,
                        ],
                    )?;
                } else {
                    transaction.execute(
                        r#"
                        INSERT OR IGNORE INTO sync_entity_order (
                          entity_type,
                          entity_id,
                          position,
                          updated_revision
                        )
                        VALUES (
                          ?1,
                          ?2,
                          COALESCE((
                            SELECT MAX(position) + 1
                            FROM sync_entity_order
                            WHERE entity_type = ?1
                          ), 0),
                          ?3
                        )
                        "#,
                        params![request.entity_type.as_str(), &request.entity_id, revision],
                    )?;
                }
            }

            let result = SyncMutationResult {
                operation_id: request.operation_id.clone(),
                entity_type: request.entity_type,
                entity_id: request.entity_id.clone(),
                revision,
                deleted: request.operation_type == SyncOperationType::Delete,
                idempotent_replay: false,
            };
            let result_json = serde_json::to_string(&result)?;

            transaction.execute(
                r#"
                INSERT INTO applied_operations (
                  operation_id,
                  request_hash,
                  device_id,
                  entity_type,
                  entity_id,
                  result_revision,
                  result_json
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#,
                params![
                    &request.operation_id,
                    &request_hash,
                    &request.device_id,
                    request.entity_type.as_str(),
                    &request.entity_id,
                    revision,
                    &result_json,
                ],
            )?;

            if matches!(origin, MutationOrigin::Local) {
                transaction.execute(
                    r#"
                    INSERT INTO sync_outbox (
                      operation_id,
                      change_set_id,
                      device_id,
                      entity_type,
                      entity_id,
                      base_revision,
                      result_revision,
                      operation_type,
                      payload_json,
                      order_position,
                      request_hash
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                    "#,
                    params![
                        &request.operation_id,
                        &request.change_set_id,
                        &request.device_id,
                        request.entity_type.as_str(),
                        &request.entity_id,
                        request.base_revision,
                        revision,
                        request.operation_type.as_str(),
                        payload_json.as_deref(),
                        request.order_position,
                        &request_hash,
                    ],
                )?;
            }

            transaction.commit()?;
            Ok(result)
        })
    }

    pub fn current_sync_revision(&self) -> StorageResult<i64> {
        self.with_connection(|connection| {
            Ok(connection.query_row(
                "SELECT global_revision FROM sync_meta WHERE singleton_id = 1",
                [],
                |row| row.get(0),
            )?)
        })
    }

    pub fn load_sync_entity(
        &self,
        entity_type: SyncEntityType,
        entity_id: &str,
    ) -> StorageResult<Option<SyncEntityRecord>> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    r#"
                    SELECT
                      entities.entity_type,
                      entities.entity_id,
                      entities.revision,
                      entities.created_revision,
                      entities.created_at,
                      entities.created_by_device_id,
                      entities.updated_at,
                      entities.updated_by_device_id,
                      entities.deleted_at,
                      entities.payload_json,
                      entity_order.position
                    FROM sync_entities AS entities
                    LEFT JOIN sync_entity_order AS entity_order
                      ON entity_order.entity_type = entities.entity_type
                     AND entity_order.entity_id = entities.entity_id
                    WHERE entities.entity_type = ?1 AND entities.entity_id = ?2
                    "#,
                    params![entity_type.as_str(), entity_id],
                    RawEntityRow::from_row,
                )
                .optional()?
                .map(RawEntityRow::into_record)
                .transpose()
        })
    }

    pub fn changes_since(
        &self,
        after_revision: i64,
        limit: usize,
    ) -> StorageResult<Vec<SyncEntityRecord>> {
        if after_revision < 0 || limit == 0 || limit > 1_000 {
            return Err(StorageError::InvalidMutation(
                "changes_since requires revision >= 0 and limit 1..=1000".into(),
            ));
        }
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                r#"
                SELECT
                  entities.entity_type,
                  entities.entity_id,
                  entities.revision,
                  entities.created_revision,
                  entities.created_at,
                  entities.created_by_device_id,
                  entities.updated_at,
                  entities.updated_by_device_id,
                  entities.deleted_at,
                  entities.payload_json,
                  entity_order.position
                FROM sync_entities AS entities
                LEFT JOIN sync_entity_order AS entity_order
                  ON entity_order.entity_type = entities.entity_type
                 AND entity_order.entity_id = entities.entity_id
                WHERE entities.revision > ?1
                ORDER BY entities.revision ASC
                LIMIT ?2
                "#,
            )?;
            let rows = statement
                .query_map(
                    params![after_revision, limit as i64],
                    RawEntityRow::from_row,
                )?
                .collect::<Result<Vec<_>, _>>()?;
            rows.into_iter().map(RawEntityRow::into_record).collect()
        })
    }

    pub fn pending_outbox(&self, limit: usize) -> StorageResult<Vec<OutboxOperation>> {
        if limit == 0 || limit > 1_000 {
            return Err(StorageError::InvalidMutation(
                "pending_outbox limit must be 1..=1000".into(),
            ));
        }
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                r#"
                SELECT
                  operation_id,
                  change_set_id,
                  device_id,
                  entity_type,
                  entity_id,
                  base_revision,
                  result_revision,
                  operation_type,
                  payload_json,
                  order_position,
                  request_hash,
                  created_at,
                  attempt_count,
                  last_attempt_at,
                  acknowledged_at
                FROM sync_outbox
                WHERE acknowledged_at IS NULL
                ORDER BY result_revision ASC
                LIMIT ?1
                "#,
            )?;
            let rows = statement
                .query_map([limit as i64], RawOutboxRow::from_row)?
                .collect::<Result<Vec<_>, _>>()?;
            rows.into_iter().map(RawOutboxRow::into_operation).collect()
        })
    }

    pub fn record_outbox_attempt(&self, operation_id: &str) -> StorageResult<bool> {
        self.with_connection(|connection| {
            Ok(connection.execute(
                r#"
                UPDATE sync_outbox
                SET attempt_count = attempt_count + 1,
                    last_attempt_at = CURRENT_TIMESTAMP
                WHERE operation_id = ?1 AND acknowledged_at IS NULL
                "#,
                [operation_id],
            )? == 1)
        })
    }

    pub fn acknowledge_outbox(&self, operation_id: &str) -> StorageResult<bool> {
        self.with_connection(|connection| {
            Ok(connection.execute(
                r#"
                UPDATE sync_outbox
                SET acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP)
                WHERE operation_id = ?1
                "#,
                [operation_id],
            )? == 1)
        })
    }
}

fn validate_request(request: &SyncMutationRequest) -> StorageResult<()> {
    for (name, value) in [
        ("operationId", request.operation_id.as_str()),
        ("changeSetId", request.change_set_id.as_str()),
        ("deviceId", request.device_id.as_str()),
        ("entityId", request.entity_id.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(StorageError::InvalidMutation(format!(
                "{name} cannot be blank"
            )));
        }
    }
    if Uuid::parse_str(&request.operation_id).is_err() {
        return Err(StorageError::InvalidMutation(
            "operationId must be a UUID".into(),
        ));
    }
    if Uuid::parse_str(&request.change_set_id).is_err() {
        return Err(StorageError::InvalidMutation(
            "changeSetId must be a UUID".into(),
        ));
    }
    if request.base_revision < 0 {
        return Err(StorageError::InvalidMutation(
            "baseRevision cannot be negative".into(),
        ));
    }
    if request.order_position.is_some_and(|position| position < 0) {
        return Err(StorageError::InvalidMutation(
            "orderPosition cannot be negative".into(),
        ));
    }
    match request.operation_type {
        SyncOperationType::Upsert => validate_payload_identity(request)?,
        SyncOperationType::Delete if request.payload.is_some() => {
            return Err(StorageError::InvalidMutation(
                "delete operation cannot contain a payload".into(),
            ));
        }
        SyncOperationType::Delete => validate_entity_key(request)?,
    }
    Ok(())
}

fn validate_entity_key(request: &SyncMutationRequest) -> StorageResult<()> {
    if request.entity_type == SyncEntityType::Settings && request.entity_id != "global" {
        return Err(StorageError::InvalidMutation(
            "settings entityId must be global".into(),
        ));
    }
    if request.entity_type == SyncEntityType::Gym && Uuid::parse_str(&request.entity_id).is_err() {
        return Err(StorageError::InvalidMutation(
            "gym entityId must be a sidecar UUID".into(),
        ));
    }
    Ok(())
}

fn validate_payload_identity(request: &SyncMutationRequest) -> StorageResult<()> {
    validate_entity_key(request)?;
    let payload = request.payload.as_ref().ok_or_else(|| {
        StorageError::InvalidMutation("upsert operation requires a payload".into())
    })?;
    let object = payload.as_object().ok_or_else(|| {
        StorageError::InvalidMutation("sync entity payload must be a JSON object".into())
    })?;
    let identity_field = match request.entity_type {
        SyncEntityType::Workout => Some("id"),
        SyncEntityType::DailyEntry => Some("date"),
        SyncEntityType::TrainingTemplate => Some("id"),
        SyncEntityType::ExerciseDefinition => Some("id"),
        SyncEntityType::CoachNote => Some("rangeKey"),
        SyncEntityType::Gym => {
            let name = object
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if name.trim().is_empty() {
                return Err(StorageError::InvalidMutation(
                    "gym payload requires a non-blank name".into(),
                ));
            }
            None
        }
        SyncEntityType::Settings => None,
    };
    if let Some(field) = identity_field {
        let payload_id = object
            .get(field)
            .and_then(Value::as_str)
            .unwrap_or_default();
        if payload_id != request.entity_id {
            return Err(StorageError::InvalidMutation(format!(
                "{} payload {field} must equal entityId",
                request.entity_type.as_str()
            )));
        }
    }
    Ok(())
}

fn request_hash(request: &SyncMutationRequest, origin: MutationOrigin) -> StorageResult<String> {
    let mut value = serde_json::to_value(request)?;
    let object = value.as_object_mut().ok_or_else(|| {
        StorageError::InvalidMutation("mutation request did not serialize as an object".into())
    })?;
    object.insert("origin".into(), Value::String(origin.as_str().into()));
    let canonical = canonical_json(&value);
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&canonical)?)
    ))
}

pub(crate) fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(canonical_json).collect()),
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let mut canonical = Map::new();
            for key in keys {
                canonical.insert(key.clone(), canonical_json(&object[key]));
            }
            Value::Object(canonical)
        }
        _ => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DATABASE_FILENAME;
    use serde_json::json;
    use tempfile::tempdir;

    fn store() -> (tempfile::TempDir, NativeAppDataStore) {
        let directory = tempdir().expect("temporary repository directory");
        let store = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME))
            .expect("native store");
        (directory, store)
    }

    fn workout_request(operation_id: &str, base_revision: i64, reps: i64) -> SyncMutationRequest {
        SyncMutationRequest {
            operation_id: operation_id.into(),
            change_set_id: "10000000-0000-4000-8000-000000000001".into(),
            device_id: "desktop-test".into(),
            entity_type: SyncEntityType::Workout,
            entity_id: "workout-existing-id".into(),
            base_revision,
            order_position: Some(0),
            operation_type: SyncOperationType::Upsert,
            payload: Some(json!({
                "id": "workout-existing-id",
                "date": "2026-08-26",
                "templateId": "template-a",
                "templateCode": "A",
                "templateName": "PUSH",
                "exercises": [{
                    "id": "snapshot-exercise",
                    "exerciseId": "canonical-bench",
                    "name": "Bench Press snapshot",
                    "sets": [{ "id": "set-a", "weight": 90.5, "reps": reps }]
                }]
            })),
        }
    }

    #[test]
    fn local_mutation_atomically_writes_entity_outbox_and_idempotency_result() {
        let (_directory, store) = store();
        let request = workout_request("00000000-0000-4000-8000-000000000001", 0, 6);

        let applied = store
            .apply_local_mutation(&request)
            .expect("apply local mutation");
        let replay = store
            .apply_local_mutation(&request)
            .expect("replay local mutation");
        let entity = store
            .load_sync_entity(SyncEntityType::Workout, "workout-existing-id")
            .expect("load entity")
            .expect("entity exists");
        let outbox = store.pending_outbox(10).expect("pending outbox");

        assert_eq!(applied.revision, 1);
        assert!(!applied.idempotent_replay);
        assert_eq!(replay.revision, 1);
        assert!(replay.idempotent_replay);
        assert_eq!(store.current_sync_revision().expect("revision"), 1);
        assert_eq!(entity.payload, request.payload);
        assert_eq!(outbox.len(), 1);
        assert_eq!(outbox[0].operation_id, request.operation_id);
        assert_eq!(outbox[0].result_revision, 1);
        assert_eq!(outbox[0].order_position, Some(0));
    }

    #[test]
    fn conflict_and_operation_id_reuse_fail_without_advancing_revision() {
        let (_directory, store) = store();
        let first = workout_request("00000000-0000-4000-8000-000000000002", 0, 6);
        store.apply_local_mutation(&first).expect("first mutation");

        let reused = workout_request("00000000-0000-4000-8000-000000000002", 0, 999);
        assert!(matches!(
            store.apply_local_mutation(&reused),
            Err(StorageError::OperationIdReuse(_))
        ));

        let stale = workout_request("00000000-0000-4000-8000-000000000003", 0, 8);
        assert!(matches!(
            store.apply_local_mutation(&stale),
            Err(StorageError::Conflict {
                base_revision: 0,
                current_revision: 1,
                ..
            })
        ));
        assert_eq!(store.current_sync_revision().expect("revision"), 1);
        assert_eq!(store.pending_outbox(10).expect("outbox").len(), 1);
    }

    #[test]
    fn remote_tombstone_has_no_outbox_and_blocks_stale_resurrection() {
        let (_directory, store) = store();
        let first = workout_request("00000000-0000-4000-8000-000000000004", 0, 6);
        let created = store.apply_remote_mutation(&first).expect("remote create");
        let delete = SyncMutationRequest {
            operation_id: "00000000-0000-4000-8000-000000000005".into(),
            change_set_id: "10000000-0000-4000-8000-000000000002".into(),
            device_id: "mobile-test".into(),
            entity_type: SyncEntityType::Workout,
            entity_id: "workout-existing-id".into(),
            base_revision: created.revision,
            order_position: None,
            operation_type: SyncOperationType::Delete,
            payload: None,
        };
        let deleted = store.apply_remote_mutation(&delete).expect("remote delete");
        let replay = store
            .apply_remote_mutation(&delete)
            .expect("replay remote delete");
        let stale = workout_request("00000000-0000-4000-8000-000000000006", 1, 12);

        assert_eq!(deleted.revision, 2);
        assert!(replay.idempotent_replay);
        assert!(matches!(
            store.apply_remote_mutation(&stale),
            Err(StorageError::Conflict {
                base_revision: 1,
                current_revision: 2,
                ..
            })
        ));
        let tombstone = store
            .load_sync_entity(SyncEntityType::Workout, "workout-existing-id")
            .expect("load tombstone")
            .expect("tombstone exists");
        assert!(tombstone.deleted_at.is_some());
        assert!(tombstone.payload.is_none());
        assert!(store.pending_outbox(10).expect("outbox").is_empty());
        assert_eq!(
            store.changes_since(0, 10).expect("changes"),
            vec![tombstone]
        );
    }

    #[test]
    fn injected_outbox_failure_rolls_back_entity_revision_and_applied_operation() {
        let (_directory, store) = store();
        store
            .with_connection(|connection| {
                connection.execute_batch(
                    r#"
                    CREATE TRIGGER fail_sync_outbox_insert
                    BEFORE INSERT ON sync_outbox
                    BEGIN
                      SELECT RAISE(ABORT, 'injected outbox failure');
                    END;
                    "#,
                )?;
                Ok(())
            })
            .expect("install failpoint trigger");
        let request = workout_request("00000000-0000-4000-8000-000000000007", 0, 6);

        assert!(matches!(
            store.apply_local_mutation(&request),
            Err(StorageError::Sqlite(_))
        ));
        store
            .with_connection(|connection| {
                for table in ["sync_entities", "sync_outbox", "applied_operations"] {
                    let count: i64 = connection.query_row(
                        &format!("SELECT COUNT(*) FROM {table}"),
                        [],
                        |row| row.get(0),
                    )?;
                    assert_eq!(count, 0, "{table} must roll back");
                }
                Ok(())
            })
            .expect("verify rollback");
        assert_eq!(store.current_sync_revision().expect("revision"), 0);
    }

    #[test]
    fn outbox_attempt_and_acknowledgement_are_durable() {
        let (_directory, store) = store();
        let request = workout_request("00000000-0000-4000-8000-000000000008", 0, 6);
        store
            .apply_local_mutation(&request)
            .expect("local mutation");

        assert!(store
            .record_outbox_attempt(&request.operation_id)
            .expect("record attempt"));
        let attempted = store.pending_outbox(10).expect("outbox");
        assert_eq!(attempted[0].attempt_count, 1);
        assert!(attempted[0].last_attempt_at.is_some());

        assert!(store
            .acknowledge_outbox(&request.operation_id)
            .expect("acknowledge"));
        assert!(store.pending_outbox(10).expect("pending outbox").is_empty());
    }

    #[test]
    fn identity_validation_preserves_daily_date_and_rejects_payload_remapping() {
        let (_directory, store) = store();
        let request = SyncMutationRequest {
            operation_id: "00000000-0000-4000-8000-000000000009".into(),
            change_set_id: "10000000-0000-4000-8000-000000000003".into(),
            device_id: "mobile-test".into(),
            entity_type: SyncEntityType::DailyEntry,
            entity_id: "2026-08-26".into(),
            base_revision: 0,
            order_position: Some(0),
            operation_type: SyncOperationType::Upsert,
            payload: Some(json!({ "id": "legacy-daily-id", "date": "2026-08-25" })),
        };

        assert!(matches!(
            store.apply_remote_mutation(&request),
            Err(StorageError::InvalidMutation(_))
        ));
        assert_eq!(store.current_sync_revision().expect("revision"), 0);
    }

    #[test]
    fn canonical_request_hash_ignores_object_key_order_but_preserves_array_order() {
        let first = workout_request("00000000-0000-4000-8000-000000000010", 0, 6);
        let mut reordered = first.clone();
        reordered.payload = Some(json!({
            "templateName": "PUSH",
            "templateCode": "A",
            "templateId": "template-a",
            "id": "workout-existing-id",
            "exercises": [{
                "sets": [{ "reps": 6, "weight": 90.5, "id": "set-a" }],
                "name": "Bench Press snapshot",
                "exerciseId": "canonical-bench",
                "id": "snapshot-exercise"
            }],
            "date": "2026-08-26"
        }));

        assert_eq!(
            request_hash(&first, MutationOrigin::Remote).expect("first hash"),
            request_hash(&reordered, MutationOrigin::Remote).expect("reordered hash")
        );
        reordered.payload.as_mut().expect("payload")["exercises"][0]["sets"] =
            json!([{ "id": "set-b" }, { "id": "set-a", "weight": 90.5, "reps": 6 }]);
        assert_ne!(
            request_hash(&first, MutationOrigin::Remote).expect("first hash"),
            request_hash(&reordered, MutationOrigin::Remote).expect("changed array hash")
        );
    }
}
