use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use greekgod_storage::{NativeAppDataStore, PairedDeviceCredentials, StorageError};
use greekgod_sync::{
    CompatibilityRequest, HandshakeResponse, PullRequest, PullResponse, PushRequest, PushResponse,
    SyncEngine, SyncEngineError, SyncStatus,
};
use serde::Serialize;
use std::sync::Arc;

#[derive(Clone)]
struct ServiceState {
    engine: Arc<SyncEngine>,
    store: NativeAppDataStore,
}

const DEVICE_ID_HEADER: &str = "x-greekgod-device-id";

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
    credentials: PairedDeviceCredentials,
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
    service_id: String,
) -> Result<Router, SyncEngineError> {
    let state = ServiceState {
        engine: Arc::new(SyncEngine::new(store.clone(), service_id)?),
        store,
    };
    Ok(Router::new()
        .route("/v1/health", get(health))
        .route("/v1/pair", post(pair))
        .route("/v1/handshake", post(handshake))
        .route("/v1/sync/push", post(push))
        .route("/v1/sync/pull", post(pull))
        .route("/v1/sync/status", get(status))
        .with_state(state))
}

async fn health(State(state): State<ServiceState>) -> Result<Json<HealthResponse>, ApiError> {
    let status = state.engine.status()?;
    Ok(Json(HealthResponse {
        service_id: status.service_id,
        service_version: status.service_version,
        protocol_version: status.protocol_version,
        schema_version: status.schema_version,
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
            },
        )
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
            schema_min: 4,
            schema_max: 4,
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
        assert_eq!(handshake.schema_version, 4);
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
}
