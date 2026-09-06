use greekgod_storage::{NativeAppDataStore, PairedDeviceCredentials, StorageError};
use greekgod_sync::{
    CompatibilityRequest, HandshakeResponse, OperationOutcome, PullRequest, PullResponse,
    PushRequest, PushResponse, PROTOCOL_VERSION,
};
use reqwest::Client;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, WebPkiSupportedAlgorithms};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, Error as RustlsError, SignatureScheme};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::Duration;
use std::{future::Future, pin::Pin};
use thiserror::Error;

pub const SUPPORTED_SCHEMA_VERSION: i64 = 7;
const PULL_PAGE_SIZE: usize = 500;

#[derive(Debug, Error)]
pub enum MobileSyncError {
    #[error("mobile sync configuration is invalid: {0}")]
    InvalidConfiguration(String),
    #[error("paired PC is unavailable: {0}")]
    PcUnavailable(String),
    #[error("pinned TLS identity does not match the paired PC")]
    PinMismatch,
    #[error("mobile and PC versions are incompatible: {0}")]
    Incompatible(String),
    #[error("paired device authentication failed")]
    Unauthorized,
    #[error("sync service rejected an operation: {0}")]
    RejectedOperation(String),
    #[error("local mobile data remains safe but sync storage failed: {0}")]
    Storage(#[from] StorageError),
    #[error("sync transport failed: {0}")]
    Transport(String),
}

impl MobileSyncError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidConfiguration(_) => "invalid_configuration",
            Self::PcUnavailable(_) => "pc_unavailable",
            Self::PinMismatch => "pin_mismatch",
            Self::Incompatible(_) => "incompatible",
            Self::Unauthorized => "unauthorized",
            Self::RejectedOperation(_) => "rejected_operation",
            Self::Storage(_) => "local_storage_failed",
            Self::Transport(_) => "transport_failed",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairingInput {
    pub base_url: String,
    pub service_id: String,
    pub certificate_fingerprint_sha256: String,
    pub nonce: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairingResult {
    pub service_id: String,
    pub certificate_fingerprint_sha256: String,
    pub credentials: PairedDeviceCredentials,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MobileSyncReport {
    pub server_revision: i64,
    pub pushed_operations: usize,
    pub pulled_changes: usize,
    pub conflicts_resolved: usize,
    pub pending_changes: usize,
}

pub type TransportFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, MobileSyncError>> + Send + 'a>>;

pub trait SyncTransport: Sync {
    fn handshake(
        &self,
        compatibility: CompatibilityRequest,
    ) -> TransportFuture<'_, HandshakeResponse>;
    fn push(&self, request: PushRequest) -> TransportFuture<'_, PushResponse>;
    fn pull(&self, request: PullRequest) -> TransportFuture<'_, PullResponse>;
}

#[derive(Debug)]
struct FingerprintVerifier {
    expected: [u8; 32],
    algorithms: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for FingerprintVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, RustlsError> {
        let actual: [u8; 32] = Sha256::digest(end_entity.as_ref()).into();
        if actual != self.expected {
            return Err(RustlsError::General(
                "GreekGod certificate pin mismatch".into(),
            ));
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        verify_tls12_signature(message, certificate, signature, &self.algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        verify_tls13_signature(message, certificate, signature, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

#[derive(Clone)]
pub struct LanSyncTransport {
    client: Client,
    base_url: String,
    device_id: String,
    device_token: String,
}

impl LanSyncTransport {
    pub fn pinned(
        base_url: &str,
        fingerprint: &str,
        device_id: &str,
        device_token: &str,
    ) -> Result<Self, MobileSyncError> {
        if !base_url.starts_with("https://")
            || device_id.trim().is_empty()
            || device_token.trim().is_empty()
        {
            return Err(MobileSyncError::InvalidConfiguration(
                "HTTPS URL, deviceId and device token are required".into(),
            ));
        }
        let expected = decode_fingerprint(fingerprint)?;
        let provider = rustls::crypto::ring::default_provider();
        let verifier = FingerprintVerifier {
            expected,
            algorithms: provider.signature_verification_algorithms,
        };
        let tls = rustls::ClientConfig::builder_with_provider(Arc::new(provider))
            .with_safe_default_protocol_versions()
            .map_err(|error| MobileSyncError::Transport(error.to_string()))?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(verifier))
            .with_no_client_auth();
        let client = Client::builder()
            .https_only(true)
            .timeout(Duration::from_secs(12))
            .tls_backend_preconfigured(tls)
            .build()
            .map_err(classify_reqwest_error)?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_owned(),
            device_id: device_id.to_owned(),
            device_token: device_token.to_owned(),
        })
    }

    pub async fn pair(
        input: &PairingInput,
        device_id: &str,
        display_name: &str,
    ) -> Result<PairingResult, MobileSyncError> {
        let transport = Self::pinned(
            &input.base_url,
            &input.certificate_fingerprint_sha256,
            device_id,
            "pairing-placeholder",
        )?;
        let response = transport
            .client
            .post(format!("{}/v1/pair", transport.base_url))
            .json(&serde_json::json!({
                "nonce": input.nonce,
                "deviceId": device_id,
                "displayName": display_name,
            }))
            .send()
            .await
            .map_err(classify_reqwest_error)?;
        let status = response.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(MobileSyncError::Unauthorized);
        }
        if !status.is_success() {
            return Err(MobileSyncError::Transport(format!(
                "pair returned HTTP {status}"
            )));
        }
        let paired: PairingResult = response
            .json()
            .await
            .map_err(|error| MobileSyncError::Transport(error.to_string()))?;
        if paired.service_id != input.service_id
            || !paired
                .certificate_fingerprint_sha256
                .eq_ignore_ascii_case(&input.certificate_fingerprint_sha256)
            || paired.credentials.device_id != device_id
        {
            return Err(MobileSyncError::PinMismatch);
        }
        Ok(paired)
    }

    fn authenticated(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
            .bearer_auth(&self.device_token)
            .header("x-greekgod-device-id", &self.device_id)
    }

    async fn json_post<T: Serialize, R: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &T,
    ) -> Result<R, MobileSyncError> {
        let response = self
            .authenticated(
                self.client
                    .post(format!("{}{path}", self.base_url))
                    .json(body),
            )
            .send()
            .await
            .map_err(classify_reqwest_error)?;
        let status = response.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(MobileSyncError::Unauthorized);
        }
        if status.as_u16() == 426 {
            return Err(MobileSyncError::Incompatible(
                "protocolVersion lub schemaVersion wymaga aktualizacji aplikacji".into(),
            ));
        }
        if !status.is_success() {
            return Err(MobileSyncError::Transport(format!(
                "{path} returned HTTP {status}"
            )));
        }
        response
            .json()
            .await
            .map_err(|error| MobileSyncError::Transport(error.to_string()))
    }
}

impl SyncTransport for LanSyncTransport {
    fn handshake(
        &self,
        compatibility: CompatibilityRequest,
    ) -> TransportFuture<'_, HandshakeResponse> {
        Box::pin(async move { self.json_post("/v1/handshake", &compatibility).await })
    }

    fn push(&self, request: PushRequest) -> TransportFuture<'_, PushResponse> {
        Box::pin(async move { self.json_post("/v1/sync/push", &request).await })
    }

    fn pull(&self, request: PullRequest) -> TransportFuture<'_, PullResponse> {
        Box::pin(async move { self.json_post("/v1/sync/pull", &request).await })
    }
}

pub struct MobileSyncEngine<T> {
    store: NativeAppDataStore,
    transport: T,
    service_id: String,
    device_id: String,
    app_version: String,
}

impl<T: SyncTransport> MobileSyncEngine<T> {
    pub fn new(
        store: NativeAppDataStore,
        transport: T,
        service_id: impl Into<String>,
        device_id: impl Into<String>,
        app_version: impl Into<String>,
    ) -> Result<Self, MobileSyncError> {
        let engine = Self {
            store,
            transport,
            service_id: service_id.into(),
            device_id: device_id.into(),
            app_version: app_version.into(),
        };
        if engine.service_id.trim().is_empty()
            || engine.device_id.trim().is_empty()
            || engine.app_version.trim().is_empty()
        {
            return Err(MobileSyncError::InvalidConfiguration(
                "serviceId, deviceId and app version are required".into(),
            ));
        }
        Ok(engine)
    }

    pub async fn sync_once(&self) -> Result<MobileSyncReport, MobileSyncError> {
        let remote = self
            .store
            .load_sync_remote(&self.service_id)?
            .ok_or_else(|| MobileSyncError::InvalidConfiguration("paired PC is missing".into()))?;
        let mut compatibility = self.compatibility(remote.last_pulled_revision);
        let reconcile_initial_snapshot =
            remote.last_pulled_revision == 0 && self.store.pending_outbox(1)?.is_empty();
        let handshake = self.transport.handshake(compatibility.clone()).await?;
        if handshake.service_id != self.service_id
            || handshake.protocol_version != PROTOCOL_VERSION
            || handshake.schema_version != SUPPORTED_SCHEMA_VERSION
        {
            return Err(MobileSyncError::Incompatible(
                "paired service identity or versions changed".into(),
            ));
        }
        if handshake.server_revision < remote.last_pulled_revision {
            return Err(MobileSyncError::Incompatible(
                "paired PC revision moved backwards; automatic reconciliation was refused".into(),
            ));
        }

        let mut pushed = 0_usize;
        let mut pulled = 0_usize;
        let conflicts = self.push_pending(&mut compatibility, &mut pushed).await?;
        pulled += self
            .pull_all(&mut compatibility, reconcile_initial_snapshot)
            .await?;
        if conflicts > 0 {
            let unresolved = self.push_pending(&mut compatibility, &mut pushed).await?;
            if unresolved > 0 {
                return Err(MobileSyncError::RejectedOperation(
                    "conflict remained after pulling the latest PC state; local outbox was preserved"
                        .into(),
                ));
            }
            pulled += self.pull_all(&mut compatibility, false).await?;
        }
        let final_remote = self
            .store
            .load_sync_remote(&self.service_id)?
            .ok_or_else(|| MobileSyncError::InvalidConfiguration("paired PC disappeared".into()))?;
        Ok(MobileSyncReport {
            server_revision: final_remote.last_pulled_revision,
            pushed_operations: pushed,
            pulled_changes: pulled,
            conflicts_resolved: conflicts,
            pending_changes: self.store.pending_outbox(1_000)?.len(),
        })
    }

    fn compatibility(&self, last_server_revision: i64) -> CompatibilityRequest {
        CompatibilityRequest {
            app_version: self.app_version.clone(),
            protocol_min: PROTOCOL_VERSION,
            protocol_max: PROTOCOL_VERSION,
            schema_min: SUPPORTED_SCHEMA_VERSION,
            schema_max: SUPPORTED_SCHEMA_VERSION,
            device_id: self.device_id.clone(),
            last_server_revision,
        }
    }

    async fn push_pending(
        &self,
        compatibility: &mut CompatibilityRequest,
        pushed: &mut usize,
    ) -> Result<usize, MobileSyncError> {
        let mut conflicts = 0_usize;
        loop {
            let Some(operation) = self
                .store
                .prepare_remote_outbox(&self.service_id, 1)?
                .into_iter()
                .next()
            else {
                break;
            };
            self.store
                .record_outbox_attempt(&operation.request.operation_id)?;
            let expected_operation_id = operation.request.operation_id.clone();
            let response = self
                .transport
                .push(PushRequest {
                    compatibility: compatibility.clone(),
                    operations: vec![operation.request.clone()],
                })
                .await?;
            if response.outcomes.len() != 1 {
                return Err(MobileSyncError::Transport(
                    "push response must contain exactly one operation outcome".into(),
                ));
            }
            let outcome = response
                .outcomes
                .into_iter()
                .next()
                .expect("length checked");
            match outcome {
                OperationOutcome::Accepted { result } => {
                    if result.operation_id != expected_operation_id {
                        return Err(MobileSyncError::Transport(
                            "push response operationId does not match the request".into(),
                        ));
                    }
                    self.store.acknowledge_remote_operation(
                        &self.service_id,
                        &result.operation_id,
                        result.revision,
                    )?;
                    *pushed += 1;
                }
                OperationOutcome::Conflict { operation_id, .. } => {
                    if operation_id != expected_operation_id {
                        return Err(MobileSyncError::Transport(
                            "conflict response operationId does not match the request".into(),
                        ));
                    }
                    conflicts += 1;
                    break;
                }
                OperationOutcome::Rejected {
                    operation_id,
                    kind,
                    message,
                } => {
                    if operation_id != expected_operation_id {
                        return Err(MobileSyncError::Transport(
                            "rejection response operationId does not match the request".into(),
                        ));
                    }
                    return Err(MobileSyncError::RejectedOperation(format!(
                        "{kind}: {message}"
                    )));
                }
            }
            compatibility.last_server_revision = response.server_revision;
        }
        Ok(conflicts)
    }

    async fn pull_all(
        &self,
        compatibility: &mut CompatibilityRequest,
        reconcile_initial_snapshot: bool,
    ) -> Result<usize, MobileSyncError> {
        let mut pulled = 0_usize;
        loop {
            let remote = self
                .store
                .load_sync_remote(&self.service_id)?
                .ok_or_else(|| {
                    MobileSyncError::InvalidConfiguration("paired PC is missing".into())
                })?;
            compatibility.last_server_revision = remote.last_pulled_revision;
            let response = self
                .transport
                .pull(PullRequest {
                    compatibility: compatibility.clone(),
                    after_revision: remote.last_pulled_revision,
                    limit: PULL_PAGE_SIZE,
                })
                .await?;
            if response.server_revision < remote.last_pulled_revision {
                return Err(MobileSyncError::Transport(
                    "pull response server revision moved backwards".into(),
                ));
            }
            let mut previous_revision = remote.last_pulled_revision;
            for change in &response.changes {
                if change.revision <= previous_revision
                    || change.revision > response.server_revision
                {
                    return Err(MobileSyncError::Transport(
                        "pull response changes are outside the ordered revision range".into(),
                    ));
                }
                previous_revision = change.revision;
            }
            let page_cursor = response
                .changes
                .last()
                .map(|change| change.revision)
                .unwrap_or(response.server_revision);
            pulled += self.store.apply_remote_batch_and_advance_cursor(
                &self.service_id,
                &response.changes,
                page_cursor,
            )?;
            let complete =
                response.changes.len() < PULL_PAGE_SIZE || page_cursor >= response.server_revision;
            if complete {
                if page_cursor < response.server_revision {
                    self.store.apply_remote_batch_and_advance_cursor(
                        &self.service_id,
                        &[],
                        response.server_revision,
                    )?;
                }
                break;
            }
        }
        if reconcile_initial_snapshot {
            self.store
                .prune_untracked_bootstrap_entities_after_initial_pull(&self.service_id)?;
        }
        Ok(pulled)
    }
}

fn decode_fingerprint(value: &str) -> Result<[u8; 32], MobileSyncError> {
    if value.len() != 64 {
        return Err(MobileSyncError::InvalidConfiguration(
            "certificate fingerprint must contain 64 hexadecimal characters".into(),
        ));
    }
    let mut decoded = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let pair = std::str::from_utf8(pair).map_err(|_| {
            MobileSyncError::InvalidConfiguration("fingerprint is not UTF-8".into())
        })?;
        decoded[index] = u8::from_str_radix(pair, 16).map_err(|_| {
            MobileSyncError::InvalidConfiguration("fingerprint is not hexadecimal".into())
        })?;
    }
    Ok(decoded)
}

fn classify_reqwest_error(error: reqwest::Error) -> MobileSyncError {
    let message = error.to_string();
    if message.contains("pin mismatch") || message.contains("certificate pin") {
        MobileSyncError::PinMismatch
    } else if error.is_timeout() || error.is_connect() {
        MobileSyncError::PcUnavailable(message)
    } else {
        MobileSyncError::Transport(message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use greekgod_storage::{
        SyncEntityRecord, SyncEntityType, SyncMutationRequest, SyncMutationResult,
        SyncOperationType, DATABASE_FILENAME,
    };
    use serde_json::json;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    };
    use tempfile::tempdir;

    struct ScriptedTransport {
        entity: SyncEntityRecord,
        pushed: Mutex<Vec<SyncMutationRequest>>,
    }

    impl SyncTransport for ScriptedTransport {
        fn handshake(
            &self,
            request: CompatibilityRequest,
        ) -> TransportFuture<'_, HandshakeResponse> {
            Box::pin(async move {
                Ok(HandshakeResponse {
                    service_id: "service-a".into(),
                    service_version: "test".into(),
                    protocol_version: PROTOCOL_VERSION,
                    schema_version: SUPPORTED_SCHEMA_VERSION,
                    server_revision: request.last_server_revision,
                })
            })
        }

        fn push(&self, request: PushRequest) -> TransportFuture<'_, PushResponse> {
            Box::pin(async move {
                let operation = request.operations[0].clone();
                assert_eq!(operation.base_revision, 0);
                self.pushed.lock().unwrap().push(operation.clone());
                Ok(PushResponse {
                    server_revision: 5,
                    outcomes: vec![OperationOutcome::Accepted {
                        result: SyncMutationResult {
                            operation_id: operation.operation_id,
                            entity_type: operation.entity_type,
                            entity_id: operation.entity_id,
                            revision: 5,
                            deleted: false,
                            idempotent_replay: false,
                        },
                    }],
                })
            })
        }

        fn pull(&self, request: PullRequest) -> TransportFuture<'_, PullResponse> {
            Box::pin(async move {
                Ok(PullResponse {
                    server_revision: 5,
                    changes: if request.after_revision < 5 {
                        vec![self.entity.clone()]
                    } else {
                        vec![]
                    },
                })
            })
        }
    }

    #[tokio::test]
    async fn manual_engine_pushes_outbox_then_atomically_pulls_and_advances_cursor() {
        let directory = tempdir().expect("temporary mobile sync DB");
        let store = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME)).unwrap();
        store
            .bootstrap_from_legacy_snapshot(
                &json!({
                    "version": 4, "dailyEntries": [], "workouts": [], "templates": [],
                    "exerciseLibrary": [], "settings": { "gymLocations": [] }, "coachNotes": {}
                }),
                "mobile:test",
            )
            .unwrap();
        store
            .register_sync_remote("service-a", &"ab".repeat(32), "https://192.168.1.10:47832")
            .unwrap();
        let payload = json!({
            "id": "workout-a", "date": "2026-08-27", "templateId": "push",
            "templateCode": "A", "templateName": "PUSH", "exercises": []
        });
        let operation = SyncMutationRequest {
            operation_id: "92000000-0000-4000-8000-000000000001".into(),
            change_set_id: "93000000-0000-4000-8000-000000000001".into(),
            device_id: "mobile:test".into(),
            entity_type: SyncEntityType::Workout,
            entity_id: "workout-a".into(),
            base_revision: 0,
            order_position: Some(0),
            operation_type: SyncOperationType::Upsert,
            payload: Some(payload.clone()),
        };
        store.apply_local_mutation(&operation).unwrap();
        let transport = ScriptedTransport {
            entity: SyncEntityRecord {
                entity_type: SyncEntityType::Workout,
                entity_id: "workout-a".into(),
                revision: 5,
                created_revision: 5,
                created_at: "now".into(),
                created_by_device_id: "mobile:test".into(),
                updated_at: "now".into(),
                updated_by_device_id: "mobile:test".into(),
                deleted_at: None,
                order_position: Some(0),
                payload: Some(payload),
            },
            pushed: Mutex::new(vec![]),
        };
        let engine = MobileSyncEngine::new(
            store.clone(),
            transport,
            "service-a",
            "mobile:test",
            "3.0.0",
        )
        .unwrap();
        let report = engine.sync_once().await.expect("sync once");
        assert_eq!(report.pushed_operations, 1);
        assert_eq!(report.pulled_changes, 1);
        assert_eq!(report.server_revision, 5);
        assert_eq!(report.pending_changes, 0);
        assert_eq!(
            store
                .load_sync_remote("service-a")
                .unwrap()
                .unwrap()
                .last_pulled_revision,
            5
        );
    }

    struct InitialSnapshotTransport {
        entities: Vec<SyncEntityRecord>,
    }

    impl SyncTransport for InitialSnapshotTransport {
        fn handshake(
            &self,
            _request: CompatibilityRequest,
        ) -> TransportFuture<'_, HandshakeResponse> {
            Box::pin(async move {
                Ok(HandshakeResponse {
                    service_id: "service-a".into(),
                    service_version: "test".into(),
                    protocol_version: PROTOCOL_VERSION,
                    schema_version: SUPPORTED_SCHEMA_VERSION,
                    server_revision: 2,
                })
            })
        }

        fn push(&self, _request: PushRequest) -> TransportFuture<'_, PushResponse> {
            Box::pin(async move { panic!("clean initial sync must not push bootstrap data") })
        }

        fn pull(&self, request: PullRequest) -> TransportFuture<'_, PullResponse> {
            Box::pin(async move {
                Ok(PullResponse {
                    server_revision: 2,
                    changes: if request.after_revision == 0 {
                        self.entities.clone()
                    } else {
                        vec![]
                    },
                })
            })
        }
    }

    #[tokio::test]
    async fn clean_initial_pull_replaces_untracked_mobile_seed_before_first_edit() {
        let directory = tempdir().expect("temporary clean mobile DB");
        let store = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME)).unwrap();
        store
            .bootstrap_from_legacy_snapshot(
                &json!({
                    "version": 4,
                    "dailyEntries": [],
                    "workouts": [],
                    "templates": [],
                    "exerciseLibrary": [
                        { "id": "shared", "name": "Seed name", "equipmentSensitive": false },
                        { "id": "seed-only", "name": "Seed only", "equipmentSensitive": true }
                    ],
                    "settings": { "phase": "Seed" },
                    "coachNotes": {}
                }),
                "mobile:test",
            )
            .unwrap();
        store
            .register_sync_remote("service-a", &"ab".repeat(32), "https://192.168.1.10:39173")
            .unwrap();
        let transport = InitialSnapshotTransport {
            entities: vec![
                SyncEntityRecord {
                    entity_type: SyncEntityType::ExerciseDefinition,
                    entity_id: "shared".into(),
                    revision: 1,
                    created_revision: 1,
                    created_at: "now".into(),
                    created_by_device_id: "desktop:test".into(),
                    updated_at: "now".into(),
                    updated_by_device_id: "desktop:test".into(),
                    deleted_at: None,
                    order_position: Some(0),
                    payload: Some(json!({
                        "id": "shared", "name": "PC name", "equipmentSensitive": false,
                        "aliases": ["Seed name"]
                    })),
                },
                SyncEntityRecord {
                    entity_type: SyncEntityType::Settings,
                    entity_id: "global".into(),
                    revision: 2,
                    created_revision: 2,
                    created_at: "now".into(),
                    created_by_device_id: "desktop:test".into(),
                    updated_at: "now".into(),
                    updated_by_device_id: "desktop:test".into(),
                    deleted_at: None,
                    order_position: None,
                    payload: Some(json!({ "phase": "PC" })),
                },
            ],
        };
        let engine = MobileSyncEngine::new(
            store.clone(),
            transport,
            "service-a",
            "mobile:test",
            "3.0.0",
        )
        .unwrap();

        let report = engine.sync_once().await.expect("clean initial sync");
        assert_eq!(report.pushed_operations, 0);
        assert_eq!(report.pulled_changes, 2);
        assert_eq!(report.pending_changes, 0);
        let synced = store.load_authoritative_snapshot().unwrap();
        assert_eq!(
            synced.data,
            json!({
                "version": 4,
                "dailyEntries": [],
                "workouts": [],
                "templates": [],
                "exerciseLibrary": [{
                    "id": "shared", "name": "PC name", "equipmentSensitive": false,
                    "aliases": ["Seed name"]
                }],
                "settings": { "phase": "PC" },
                "coachNotes": {}
            })
        );

        let mut edited = synced.data;
        edited["dailyEntries"] = json!([{
            "id": "daily-a", "date": "2026-09-03", "weight": 79.1, "protein": 211
        }]);
        let replaced = store
            .replace_authoritative_snapshot(&edited, "mobile:test", synced.revision)
            .expect("one DailyEntry edit");
        assert_eq!(replaced.applied_operations, 1);
        let pending = store.pending_outbox(100).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].entity_type, SyncEntityType::DailyEntry);
        assert_eq!(pending[0].payload.as_ref().unwrap()["weight"], json!(79.1));
        assert_eq!(
            store.load_authoritative_snapshot().unwrap().data["dailyEntries"][0]["weight"],
            json!(79.1)
        );
    }

    struct PersistentConflictTransport {
        entity: SyncEntityRecord,
        pushes: AtomicUsize,
    }

    impl SyncTransport for PersistentConflictTransport {
        fn handshake(
            &self,
            request: CompatibilityRequest,
        ) -> TransportFuture<'_, HandshakeResponse> {
            Box::pin(async move {
                Ok(HandshakeResponse {
                    service_id: "service-a".into(),
                    service_version: "test".into(),
                    protocol_version: PROTOCOL_VERSION,
                    schema_version: SUPPORTED_SCHEMA_VERSION,
                    server_revision: request.last_server_revision,
                })
            })
        }

        fn push(&self, request: PushRequest) -> TransportFuture<'_, PushResponse> {
            Box::pin(async move {
                self.pushes.fetch_add(1, Ordering::SeqCst);
                let operation = &request.operations[0];
                Ok(PushResponse {
                    server_revision: 5,
                    outcomes: vec![OperationOutcome::Conflict {
                        operation_id: operation.operation_id.clone(),
                        entity_type: operation.entity_type.as_str().into(),
                        entity_id: operation.entity_id.clone(),
                        base_revision: operation.base_revision,
                        current_revision: 5,
                    }],
                })
            })
        }

        fn pull(&self, request: PullRequest) -> TransportFuture<'_, PullResponse> {
            Box::pin(async move {
                Ok(PullResponse {
                    server_revision: 5,
                    changes: if request.after_revision < 5 {
                        vec![self.entity.clone()]
                    } else {
                        vec![]
                    },
                })
            })
        }
    }

    #[tokio::test]
    async fn unresolved_second_conflict_fails_and_preserves_local_outbox() {
        let directory = tempdir().expect("temporary conflict DB");
        let store = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME)).unwrap();
        store
            .bootstrap_from_legacy_snapshot(
                &json!({
                    "version": 4, "dailyEntries": [], "workouts": [], "templates": [],
                    "exerciseLibrary": [], "settings": { "gymLocations": [] }, "coachNotes": {}
                }),
                "mobile:test",
            )
            .unwrap();
        store
            .register_sync_remote("service-a", &"ab".repeat(32), "https://192.168.1.10:39173")
            .unwrap();
        store
            .apply_local_mutation(&SyncMutationRequest {
                operation_id: "94000000-0000-4000-8000-000000000001".into(),
                change_set_id: "95000000-0000-4000-8000-000000000001".into(),
                device_id: "mobile:test".into(),
                entity_type: SyncEntityType::Workout,
                entity_id: "workout-conflict".into(),
                base_revision: 0,
                order_position: Some(0),
                operation_type: SyncOperationType::Upsert,
                payload: Some(json!({
                    "id": "workout-conflict", "date": "2026-08-27", "templateId": "push",
                    "templateCode": "A", "templateName": "PUSH", "exercises": []
                })),
            })
            .unwrap();
        let transport = PersistentConflictTransport {
            entity: SyncEntityRecord {
                entity_type: SyncEntityType::Workout,
                entity_id: "workout-conflict".into(),
                revision: 5,
                created_revision: 5,
                created_at: "now".into(),
                created_by_device_id: "desktop:test".into(),
                updated_at: "now".into(),
                updated_by_device_id: "desktop:test".into(),
                deleted_at: None,
                order_position: Some(0),
                payload: Some(json!({
                    "id": "workout-conflict", "date": "2026-08-26", "templateId": "pull",
                    "templateCode": "B", "templateName": "PULL", "exercises": []
                })),
            },
            pushes: AtomicUsize::new(0),
        };
        let engine = MobileSyncEngine::new(
            store.clone(),
            transport,
            "service-a",
            "mobile:test",
            "3.0.0",
        )
        .unwrap();
        let error = engine
            .sync_once()
            .await
            .expect_err("second conflict must fail closed");
        assert_eq!(error.code(), "rejected_operation");
        assert_eq!(store.pending_outbox(100).unwrap().len(), 1);
        assert_eq!(
            store
                .load_sync_remote("service-a")
                .unwrap()
                .unwrap()
                .last_pulled_revision,
            5
        );
    }
}
