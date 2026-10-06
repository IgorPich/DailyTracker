use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use greekgod_storage::{NativeAppDataStore, PairedDevice, PairedDeviceCredentials, StorageError};
use greekgod_sync::{
    CompatibilityRequest, HandshakeResponse, PullRequest, PullResponse, PushRequest, PushResponse,
    SyncEngine, SyncEngineError, SyncStatus,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

mod tls_identity;

pub use tls_identity::{
    ensure_crypto_provider, ServicePublicIdentity, ServiceTlsIdentity, TlsIdentityError,
};

#[derive(Clone)]
struct ServiceState {
    engine: Arc<SyncEngine>,
    store: NativeAppDataStore,
    certificate_fingerprint_sha256: String,
    base_url: String,
    bind_ip: IpAddr,
    desktop_control_token_hash: [u8; 32],
}

const DEVICE_ID_HEADER: &str = "x-greekgod-device-id";
const DESKTOP_CONTROL_HEADER: &str = "x-greekgod-desktop-control";
const PAIRING_WINDOW_TTL_SECONDS: u64 = 120;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    error: ErrorDetails,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorDetails {
    code: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    service_id: String,
    service_version: String,
    protocol_version: u32,
    schema_version: i64,
    certificate_fingerprint_sha256: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairRequest {
    nonce: String,
    device_id: String,
    display_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairResponse {
    service_id: String,
    certificate_fingerprint_sha256: String,
    credentials: PairedDeviceCredentials,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingBootstrap {
    base_url: String,
    service_id: String,
    nonce: String,
    certificate_fingerprint_sha256: String,
    expires_at_epoch: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatusResponse {
    service_id: String,
    certificate_fingerprint_sha256: String,
    paired_devices: Vec<PairedDevice>,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    code: String,
    message: String,
}

impl From<SyncEngineError> for ApiError {
    fn from(error: SyncEngineError) -> Self {
        let status = match error {
            SyncEngineError::InvalidCompatibility(_) => StatusCode::BAD_REQUEST,
            SyncEngineError::IncompatibleProtocol { .. }
            | SyncEngineError::IncompatibleSchema { .. } => StatusCode::UPGRADE_REQUIRED,
            SyncEngineError::Storage(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            code: error.code().into(),
            message: error.to_string(),
        }
    }
}

impl From<StorageError> for ApiError {
    fn from(error: StorageError) -> Self {
        let status = match error {
            StorageError::UnauthorizedDevice => StatusCode::UNAUTHORIZED,
            StorageError::PairingWindowClosed => StatusCode::FORBIDDEN,
            StorageError::InvalidMutation(_) => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            code: error.kind().into(),
            message: error.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: ErrorDetails {
                    code: self.code,
                    message: self.message,
                },
            }),
        )
            .into_response()
    }
}

pub fn build_router(
    store: NativeAppDataStore,
    identity: ServicePublicIdentity,
    bind: SocketAddr,
    desktop_control_token: &str,
) -> Result<Router, SyncEngineError> {
    let state = ServiceState {
        engine: Arc::new(SyncEngine::new(store.clone(), identity.service_id)?),
        store,
        certificate_fingerprint_sha256: identity.certificate_fingerprint_sha256,
        base_url: format!("https://{bind}"),
        bind_ip: bind.ip(),
        desktop_control_token_hash: Sha256::digest(desktop_control_token.as_bytes()).into(),
    };
    Ok(Router::new()
        .route("/v1/health", get(health))
        .route("/v1/pair", post(pair))
        .route("/v1/handshake", post(handshake))
        .route("/v1/sync/push", post(push))
        .route("/v1/sync/pull", post(pull))
        .route("/v1/sync/status", get(status))
        .route("/v1/device/revoke", post(revoke_current_device))
        .route("/v1/desktop/status", get(desktop_status))
        .route("/v1/desktop/pairing", post(open_desktop_pairing))
        .route("/v1/desktop/pairing/cancel", post(cancel_desktop_pairing))
        .with_state(state))
}

async fn desktop_status(
    State(state): State<ServiceState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<DesktopStatusResponse>, ApiError> {
    authorize_desktop(&state, peer, &headers)?;
    let paired_devices = state
        .store
        .paired_devices()?
        .into_iter()
        .filter(|device| device.revoked_at.is_none())
        .collect();
    Ok(Json(DesktopStatusResponse {
        service_id: state.engine.status()?.service_id,
        certificate_fingerprint_sha256: state.certificate_fingerprint_sha256,
        paired_devices,
    }))
}

async fn open_desktop_pairing(
    State(state): State<ServiceState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<Json<PairingBootstrap>, ApiError> {
    authorize_desktop(&state, peer, &headers)?;
    let window = state
        .store
        .open_pairing_window(PAIRING_WINDOW_TTL_SECONDS)?;
    Ok(Json(PairingBootstrap {
        base_url: state.base_url,
        service_id: state.engine.status()?.service_id,
        nonce: window.nonce,
        certificate_fingerprint_sha256: state.certificate_fingerprint_sha256,
        expires_at_epoch: window.expires_at_epoch,
    }))
}

async fn cancel_desktop_pairing(
    State(state): State<ServiceState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    authorize_desktop(&state, peer, &headers)?;
    state.store.close_pairing_windows()?;
    Ok(StatusCode::NO_CONTENT)
}

async fn health(State(state): State<ServiceState>) -> Result<Json<HealthResponse>, ApiError> {
    let status = state.engine.status()?;
    Ok(Json(HealthResponse {
        service_id: status.service_id,
        service_version: status.service_version,
        protocol_version: status.protocol_version,
        schema_version: status.schema_version,
        certificate_fingerprint_sha256: state.certificate_fingerprint_sha256,
    }))
}

async fn pair(
    State(state): State<ServiceState>,
    Json(request): Json<PairRequest>,
) -> Result<Json<PairResponse>, ApiError> {
    let credentials =
        state
            .store
            .pair_device(&request.nonce, &request.device_id, &request.display_name)?;
    let service_id = state.engine.status()?.service_id;
    Ok(Json(PairResponse {
        service_id,
        certificate_fingerprint_sha256: state.certificate_fingerprint_sha256,
        credentials,
    }))
}

async fn handshake(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Json(request): Json<CompatibilityRequest>,
) -> Result<Json<HandshakeResponse>, ApiError> {
    authorize(&state, &headers, &request.device_id)?;
    Ok(Json(state.engine.handshake(&request)?))
}

async fn push(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Json(request): Json<PushRequest>,
) -> Result<Json<PushResponse>, ApiError> {
    authorize(&state, &headers, &request.compatibility.device_id)?;
    Ok(Json(state.engine.push(&request)?))
}

async fn pull(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    Json(request): Json<PullRequest>,
) -> Result<Json<PullResponse>, ApiError> {
    authorize(&state, &headers, &request.compatibility.device_id)?;
    Ok(Json(state.engine.pull(&request)?))
}

async fn status(
    State(state): State<ServiceState>,
    headers: HeaderMap,
) -> Result<Json<SyncStatus>, ApiError> {
    let device_id = header_value(&headers, DEVICE_ID_HEADER)?;
    authorize(&state, &headers, device_id)?;
    Ok(Json(state.engine.status()?))
}

async fn revoke_current_device(
    State(state): State<ServiceState>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let device_id = header_value(&headers, DEVICE_ID_HEADER)?;
    authorize(&state, &headers, device_id)?;
    if !state.store.revoke_device(device_id)? {
        return Err(StorageError::UnauthorizedDevice.into());
    }
    Ok(StatusCode::NO_CONTENT)
}

fn authorize(
    state: &ServiceState,
    headers: &HeaderMap,
    expected_device_id: &str,
) -> Result<(), ApiError> {
    let device_id = header_value(headers, DEVICE_ID_HEADER)?;
    if device_id != expected_device_id {
        return Err(StorageError::UnauthorizedDevice.into());
    }
    let authorization = header_value(headers, "authorization")?;
    let (scheme, token) = authorization
        .split_once(' ')
        .ok_or(StorageError::UnauthorizedDevice)?;
    if !scheme.eq_ignore_ascii_case("bearer") || token.is_empty() {
        return Err(StorageError::UnauthorizedDevice.into());
    }
    state.store.authenticate_device(device_id, token)?;
    Ok(())
}

fn authorize_desktop(
    state: &ServiceState,
    peer: SocketAddr,
    headers: &HeaderMap,
) -> Result<(), ApiError> {
    if !peer.ip().is_loopback() && peer.ip() != state.bind_ip {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            code: "desktop_control_forbidden".into(),
            message: "Desktop control is available only to the local computer".into(),
        });
    }
    let token = header_value(headers, DESKTOP_CONTROL_HEADER)?;
    let actual: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    if actual != state.desktop_control_token_hash {
        return Err(StorageError::UnauthorizedDevice.into());
    }
    Ok(())
}

fn header_value<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, ApiError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| StorageError::UnauthorizedDevice.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use greekgod_storage::DATABASE_FILENAME;
    use greekgod_sync::PROTOCOL_VERSION;
    use tempfile::tempdir;

    fn state() -> (tempfile::TempDir, ServiceState) {
        let directory = tempdir().expect("temporary service directory");
        let store = NativeAppDataStore::new(directory.path().join(DATABASE_FILENAME))
            .expect("native store");
        let engine = SyncEngine::new(store.clone(), "service-http-test").expect("sync engine");
        (
            directory,
            ServiceState {
                engine: Arc::new(engine),
                store,
                certificate_fingerprint_sha256:
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
                base_url: "https://192.168.1.25:39173".into(),
                bind_ip: "192.168.1.25".parse().expect("bind IP"),
                desktop_control_token_hash: Sha256::digest(b"desktop-control-test").into(),
            },
        )
    }

    fn desktop_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            DESKTOP_CONTROL_HEADER,
            "desktop-control-test".parse().expect("desktop token"),
        );
        headers
    }

    fn local_desktop_peer() -> ConnectInfo<SocketAddr> {
        ConnectInfo("192.168.1.25:51000".parse().expect("desktop peer"))
    }

    async fn pair_and_headers(state: &ServiceState) -> HeaderMap {
        let window = state
            .store
            .open_pairing_window(120)
            .expect("pairing window");
        let Json(response) = pair(
            State(state.clone()),
            Json(PairRequest {
                nonce: window.nonce,
                device_id: "mobile-http-test".into(),
                display_name: "HTTP test phone".into(),
            }),
        )
        .await
        .expect("pair");
        let mut headers = HeaderMap::new();
        headers.insert(
            DEVICE_ID_HEADER,
            "mobile-http-test".parse().expect("device header"),
        );
        headers.insert(
            "authorization",
            format!("Bearer {}", response.credentials.device_token)
                .parse()
                .expect("authorization header"),
        );
        headers
    }

    fn compatibility() -> CompatibilityRequest {
        CompatibilityRequest {
            app_version: "3.0.0-test".into(),
            protocol_min: PROTOCOL_VERSION,
            protocol_max: PROTOCOL_VERSION,
            schema_min: 8,
            schema_max: 8,
            device_id: "mobile-http-test".into(),
            last_server_revision: 0,
        }
    }

    #[tokio::test]
    async fn health_and_handshake_handlers_use_the_shared_engine() {
        let (_directory, state) = state();
        let headers = pair_and_headers(&state).await;
        let Json(health) = health(State(state.clone())).await.expect("health");
        let Json(handshake) = handshake(State(state), headers, Json(compatibility()))
            .await
            .expect("handshake");

        assert_eq!(health.service_id, "service-http-test");
        assert_eq!(health.protocol_version, PROTOCOL_VERSION);
        assert_eq!(handshake.server_revision, 0);
        assert_eq!(handshake.schema_version, 8);
        assert_eq!(
            health.certificate_fingerprint_sha256,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
    }

    #[tokio::test]
    async fn incompatible_handshake_maps_to_upgrade_required() {
        let (_directory, state) = state();
        let headers = pair_and_headers(&state).await;
        let mut request = compatibility();
        request.protocol_min = 2;
        request.protocol_max = 2;

        let error = handshake(State(state), headers, Json(request))
            .await
            .expect_err("incompatible handshake");
        assert_eq!(error.status, StatusCode::UPGRADE_REQUIRED);
        assert_eq!(error.code, "incompatible_protocol");
    }

    #[tokio::test]
    async fn sync_handlers_reject_anonymous_and_revoked_devices() {
        let (_directory, state) = state();
        let anonymous = handshake(
            State(state.clone()),
            HeaderMap::new(),
            Json(compatibility()),
        )
        .await
        .expect_err("anonymous handshake");
        assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);
        let anonymous_push = push(
            State(state.clone()),
            HeaderMap::new(),
            Json(PushRequest {
                compatibility: compatibility(),
                operations: Vec::new(),
            }),
        )
        .await
        .expect_err("anonymous push");
        assert_eq!(anonymous_push.status, StatusCode::UNAUTHORIZED);
        let anonymous_pull = pull(
            State(state.clone()),
            HeaderMap::new(),
            Json(PullRequest {
                compatibility: compatibility(),
                after_revision: 0,
                limit: 100,
            }),
        )
        .await
        .expect_err("anonymous pull");
        assert_eq!(anonymous_pull.status, StatusCode::UNAUTHORIZED);
        let anonymous_status = status(State(state.clone()), HeaderMap::new())
            .await
            .expect_err("anonymous status");
        assert_eq!(anonymous_status.status, StatusCode::UNAUTHORIZED);

        let headers = pair_and_headers(&state).await;
        let mut mismatched = compatibility();
        mismatched.device_id = "different-device".into();
        let mismatch = handshake(State(state.clone()), headers.clone(), Json(mismatched))
            .await
            .expect_err("header and request device mismatch");
        assert_eq!(mismatch.status, StatusCode::UNAUTHORIZED);
        state
            .store
            .revoke_device("mobile-http-test")
            .expect("revoke device");
        let revoked = handshake(State(state), headers, Json(compatibility()))
            .await
            .expect_err("revoked handshake");
        assert_eq!(revoked.status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn authenticated_device_can_revoke_its_own_token() {
        let (_directory, state) = state();
        let headers = pair_and_headers(&state).await;
        let response = revoke_current_device(State(state.clone()), headers.clone())
            .await
            .expect("revoke current device");
        assert_eq!(response, StatusCode::NO_CONTENT);
        let rejected = handshake(State(state), headers, Json(compatibility()))
            .await
            .expect_err("revoked token");
        assert_eq!(rejected.status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn local_desktop_control_opens_and_cancels_the_authority_pairing_window() {
        let (_directory, state) = state();
        let Json(status) = desktop_status(
            State(state.clone()),
            local_desktop_peer(),
            desktop_headers(),
        )
        .await
        .expect("desktop status");
        assert_eq!(status.service_id, "service-http-test");
        assert!(status.paired_devices.is_empty());

        let Json(pairing) = open_desktop_pairing(
            State(state.clone()),
            local_desktop_peer(),
            desktop_headers(),
        )
        .await
        .expect("open pairing");
        assert_eq!(pairing.base_url, "https://192.168.1.25:39173");
        assert_eq!(pairing.service_id, "service-http-test");
        assert_eq!(pairing.nonce.len(), 32);

        cancel_desktop_pairing(
            State(state.clone()),
            local_desktop_peer(),
            desktop_headers(),
        )
        .await
        .expect("cancel pairing");
        assert!(matches!(
            state.store.pair_device(&pairing.nonce, "mobile", "Phone"),
            Err(StorageError::PairingWindowClosed)
        ));
    }

    #[tokio::test]
    async fn desktop_control_rejects_remote_lan_peers_and_wrong_tokens() {
        let (_directory, state) = state();
        let remote = desktop_status(
            State(state.clone()),
            ConnectInfo("192.168.1.50:51000".parse().expect("remote peer")),
            desktop_headers(),
        )
        .await
        .expect_err("remote peer must fail");
        assert_eq!(remote.status, StatusCode::FORBIDDEN);

        let wrong_token = desktop_status(State(state), local_desktop_peer(), HeaderMap::new())
            .await
            .expect_err("missing token must fail");
        assert_eq!(wrong_token.status, StatusCode::UNAUTHORIZED);
    }
}
