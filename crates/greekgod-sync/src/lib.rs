use greekgod_storage::{
    NativeAppDataStore, StorageError, SyncEntityRecord, SyncMutationRequest, SyncMutationResult,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const PROTOCOL_VERSION: u32 = 1;
pub const SERVICE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityRequest {
    pub app_version: String,
    pub protocol_min: u32,
    pub protocol_max: u32,
    pub schema_min: i64,
    pub schema_max: i64,
    pub device_id: String,
    pub last_server_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeResponse {
    pub service_id: String,
    pub service_version: String,
    pub protocol_version: u32,
    pub schema_version: i64,
    pub server_revision: i64,
}

#[derive(Debug, Error)]
pub enum SyncEngineError {
    #[error("invalid compatibility request: {0}")]
    InvalidCompatibility(String),
    #[error(
        "incompatible protocol: client supports {client_min}..={client_max}, service requires {service_version}"
    )]
    IncompatibleProtocol {
        client_min: u32,
        client_max: u32,
        service_version: u32,
    },
    #[error(
        "incompatible schema: client supports {client_min}..={client_max}, service uses {service_version}"
    )]
    IncompatibleSchema {
        client_min: i64,
        client_max: i64,
        service_version: i64,
    },
    #[error("sync storage failed: {0}")]
    Storage(#[from] StorageError),
}

impl SyncEngineError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidCompatibility(_) => "invalid_compatibility",
            Self::IncompatibleProtocol { .. } => "incompatible_protocol",
            Self::IncompatibleSchema { .. } => "incompatible_schema",
            Self::Storage(error) => error.kind(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PushRequest {
    pub compatibility: CompatibilityRequest,
    pub operations: Vec<SyncMutationRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PushResponse {
    pub server_revision: i64,
    pub outcomes: Vec<OperationOutcome>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum OperationOutcome {
    Accepted {
        result: SyncMutationResult,
    },
    Conflict {
        operation_id: String,
        entity_type: String,
        entity_id: String,
        base_revision: i64,
        current_revision: i64,
    },
    Rejected {
        operation_id: String,
        kind: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub compatibility: CompatibilityRequest,
    pub after_revision: i64,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullResponse {
    pub server_revision: i64,
    pub changes: Vec<SyncEntityRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub service_id: String,
    pub service_version: String,
    pub protocol_version: u32,
    pub schema_version: i64,
    pub server_revision: i64,
}

#[derive(Clone, Debug)]
pub struct SyncEngine {
    store: NativeAppDataStore,
    service_id: String,
}

impl SyncEngine {
    pub fn new(
        store: NativeAppDataStore,
        service_id: impl Into<String>,
    ) -> Result<Self, SyncEngineError> {
        let service_id = service_id.into();
        if service_id.trim().is_empty() {
            return Err(SyncEngineError::InvalidCompatibility(
                "serviceId cannot be blank".into(),
            ));
        }
        Ok(Self { store, service_id })
    }

    pub fn handshake(
        &self,
        request: &CompatibilityRequest,
    ) -> Result<HandshakeResponse, SyncEngineError> {
        validate_compatibility_shape(request)?;
        if !(request.protocol_min..=request.protocol_max).contains(&PROTOCOL_VERSION) {
            return Err(SyncEngineError::IncompatibleProtocol {
                client_min: request.protocol_min,
                client_max: request.protocol_max,
                service_version: PROTOCOL_VERSION,
            });
        }
        let schema_version = self.store.probe()?.schema_version;
        if !(request.schema_min..=request.schema_max).contains(&schema_version) {
            return Err(SyncEngineError::IncompatibleSchema {
                client_min: request.schema_min,
                client_max: request.schema_max,
                service_version: schema_version,
            });
        }
        Ok(HandshakeResponse {
            service_id: self.service_id.clone(),
            service_version: SERVICE_VERSION.into(),
            protocol_version: PROTOCOL_VERSION,
            schema_version,
            server_revision: self.store.current_sync_revision()?,
        })
    }

    pub fn push(&self, request: &PushRequest) -> Result<PushResponse, SyncEngineError> {
        self.handshake(&request.compatibility)?;
        let mut outcomes = Vec::with_capacity(request.operations.len());
        for operation in &request.operations {
            if operation.device_id != request.compatibility.device_id {
                outcomes.push(OperationOutcome::Rejected {
                    operation_id: operation.operation_id.clone(),
                    kind: "device_id_mismatch".into(),
                    message: "operation deviceId does not match handshake deviceId".into(),
                });
                continue;
            }
            match self.store.apply_remote_mutation(operation) {
                Ok(result) => outcomes.push(OperationOutcome::Accepted { result }),
                Err(StorageError::Conflict {
                    entity_type,
                    entity_id,
                    base_revision,
                    current_revision,
                }) => outcomes.push(OperationOutcome::Conflict {
                    operation_id: operation.operation_id.clone(),
                    entity_type,
                    entity_id,
                    base_revision,
                    current_revision,
                }),
                Err(error @ StorageError::InvalidMutation(_))
                | Err(error @ StorageError::OperationIdReuse(_)) => {
                    outcomes.push(OperationOutcome::Rejected {
                        operation_id: operation.operation_id.clone(),
                        kind: error.kind().into(),
                        message: error.to_string(),
                    });
                }
                Err(error) => return Err(error.into()),
            }
        }
        Ok(PushResponse {
            server_revision: self.store.current_sync_revision()?,
            outcomes,
        })
    }

    pub fn pull(&self, request: &PullRequest) -> Result<PullResponse, SyncEngineError> {
        self.handshake(&request.compatibility)?;
        Ok(PullResponse {
            server_revision: self.store.current_sync_revision()?,
            changes: self
                .store
                .changes_since(request.after_revision, request.limit)?,
        })
    }

    pub fn status(&self) -> Result<SyncStatus, SyncEngineError> {
        let probe = self.store.probe()?;
        Ok(SyncStatus {
            service_id: self.service_id.clone(),
            service_version: SERVICE_VERSION.into(),
            protocol_version: PROTOCOL_VERSION,
            schema_version: probe.schema_version,
            server_revision: self.store.current_sync_revision()?,
        })
    }
}

fn validate_compatibility_shape(request: &CompatibilityRequest) -> Result<(), SyncEngineError> {
    if request.app_version.trim().is_empty() || request.device_id.trim().is_empty() {
        return Err(SyncEngineError::InvalidCompatibility(
            "appVersion and deviceId cannot be blank".into(),
        ));
    }
    if request.protocol_min == 0
        || request.protocol_min > request.protocol_max
        || request.schema_min <= 0
        || request.schema_min > request.schema_max
        || request.last_server_revision < 0
    {
        return Err(SyncEngineError::InvalidCompatibility(
            "version ranges or lastServerRevision are invalid".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use greekgod_storage::{SyncEntityType, SyncOperationType, DATABASE_FILENAME};
    use serde_json::json;
    use tempfile::tempdir;

    fn engine() -> (tempfile::TempDir, SyncEngine) {
        let directory = tempdir().expect("temporary sync engine directory");
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
                "desktop-bootstrap",
            )
            .expect("authoritative bootstrap");
        let engine = SyncEngine::new(store, "service-test").expect("sync engine");
        (directory, engine)
    }

    fn compatibility() -> CompatibilityRequest {
        CompatibilityRequest {
            app_version: "3.0.0-test".into(),
            protocol_min: PROTOCOL_VERSION,
            protocol_max: PROTOCOL_VERSION,
            schema_min: 8,
            schema_max: 8,
            device_id: "mobile-test".into(),
            last_server_revision: 0,
        }
    }

    fn operation(operation_id: &str, base_revision: i64, reps: i64) -> SyncMutationRequest {
        SyncMutationRequest {
            operation_id: operation_id.into(),
            change_set_id: "20000000-0000-4000-8000-000000000001".into(),
            device_id: "mobile-test".into(),
            entity_type: SyncEntityType::Workout,
            entity_id: "workout-a".into(),
            base_revision,
            order_position: Some(0),
            operation_type: SyncOperationType::Upsert,
            payload: Some(json!({
                "id": "workout-a",
                "date": "2026-08-26",
                "templateId": "template-a",
                "templateCode": "A",
                "templateName": "PUSH",
                "exercises": [{
                    "id": "exercise-a",
                    "exerciseId": "bench-press",
                    "name": "Bench Press",
                    "sets": [{ "id": "set-a", "reps": reps }]
                }]
            })),
        }
    }

    #[test]
    fn handshake_rejects_incompatible_versions_before_any_write() {
        let (_directory, engine) = engine();
        let mut incompatible_protocol = compatibility();
        incompatible_protocol.protocol_min = 2;
        incompatible_protocol.protocol_max = 2;
        assert!(matches!(
            engine.handshake(&incompatible_protocol),
            Err(SyncEngineError::IncompatibleProtocol { .. })
        ));

        let mut incompatible_schema = compatibility();
        incompatible_schema.schema_min = 7;
        incompatible_schema.schema_max = 7;
        let request = PushRequest {
            compatibility: incompatible_schema,
            operations: vec![operation("30000000-0000-4000-8000-000000000001", 0, 6)],
        };
        assert!(matches!(
            engine.push(&request),
            Err(SyncEngineError::IncompatibleSchema { .. })
        ));
        assert_eq!(engine.status().expect("status").server_revision, 1);
    }

    #[test]
    fn lost_push_response_can_be_replayed_without_duplicate_change() {
        let (_directory, engine) = engine();
        let request = PushRequest {
            compatibility: compatibility(),
            operations: vec![operation("30000000-0000-4000-8000-000000000002", 0, 6)],
        };

        let first = engine.push(&request).expect("first push");
        let replay = engine.push(&request).expect("replayed push");

        assert_eq!(first.server_revision, 2);
        assert_eq!(replay.server_revision, 2);
        assert!(matches!(
            &first.outcomes[0],
            OperationOutcome::Accepted { result } if !result.idempotent_replay
        ));
        assert!(matches!(
            &replay.outcomes[0],
            OperationOutcome::Accepted { result } if result.idempotent_replay
        ));
    }

    #[test]
    fn conflicts_are_explicit_and_pull_returns_latest_entity_payload() {
        let (_directory, engine) = engine();
        engine
            .push(&PushRequest {
                compatibility: compatibility(),
                operations: vec![operation("30000000-0000-4000-8000-000000000003", 0, 6)],
            })
            .expect("initial push");
        let conflict = engine
            .push(&PushRequest {
                compatibility: compatibility(),
                operations: vec![operation("30000000-0000-4000-8000-000000000004", 0, 12)],
            })
            .expect("conflicting push response");
        assert!(matches!(
            conflict.outcomes[0],
            OperationOutcome::Conflict {
                base_revision: 0,
                current_revision: 2,
                ..
            }
        ));

        let pulled = engine
            .pull(&PullRequest {
                compatibility: compatibility(),
                after_revision: 1,
                limit: 100,
            })
            .expect("pull");
        assert_eq!(pulled.server_revision, 2);
        assert_eq!(pulled.changes.len(), 1);
        assert_eq!(
            pulled.changes[0].payload.as_ref().expect("payload")["exercises"][0]["sets"][0]["reps"],
            6
        );
    }
}
