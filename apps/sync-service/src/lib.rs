use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use greekgod_storage::NativeAppDataStore;
use greekgod_sync::{
    CompatibilityRequest, HandshakeResponse, PullRequest, PullResponse, PushRequest, PushResponse,
    SyncEngine, SyncEngineError, SyncStatus,
};
use serde::Serialize;
use std::sync::Arc;

#[derive(Clone)]
struct ServiceState {
    engine: Arc<SyncEngine>,
}

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
        engine: Arc::new(SyncEngine::new(store, service_id)?),
    };
    Ok(Router::new()
        .route("/v1/health", get(health))
        .route("/v1/handshake", post(handshake))
        .route("/v1/sync/push", post(push))
        .route("/v1/sync/pull", post(pull))
        .route("/v1/sync/status", get(status))
        .with_state(state))
}

async fn health(State(state): State<ServiceState>) -> Result<Json<SyncStatus>, ApiError> {
    Ok(Json(state.engine.status()?))
}

async fn handshake(
    State(state): State<ServiceState>,
    Json(request): Json<CompatibilityRequest>,
) -> Result<Json<HandshakeResponse>, ApiError> {
    Ok(Json(state.engine.handshake(&request)?))
}

async fn push(
    State(state): State<ServiceState>,
    Json(request): Json<PushRequest>,
) -> Result<Json<PushResponse>, ApiError> {
    Ok(Json(state.engine.push(&request)?))
}

async fn pull(
    State(state): State<ServiceState>,
    Json(request): Json<PullRequest>,
) -> Result<Json<PullResponse>, ApiError> {
    Ok(Json(state.engine.pull(&request)?))
}

async fn status(State(state): State<ServiceState>) -> Result<Json<SyncStatus>, ApiError> {
    Ok(Json(state.engine.status()?))
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
        let engine = SyncEngine::new(store, "service-http-test").expect("sync engine");
        (
            directory,
            ServiceState {
                engine: Arc::new(engine),
            },
        )
    }

    fn compatibility() -> CompatibilityRequest {
        CompatibilityRequest {
            app_version: "3.0.0-test".into(),
            protocol_min: PROTOCOL_VERSION,
            protocol_max: PROTOCOL_VERSION,
            schema_min: 3,
            schema_max: 3,
            device_id: "mobile-http-test".into(),
            last_server_revision: 0,
        }
    }

    #[tokio::test]
    async fn health_and_handshake_handlers_use_the_shared_engine() {
        let (_directory, state) = state();
        let Json(health) = health(State(state.clone())).await.expect("health");
        let Json(handshake) = handshake(State(state), Json(compatibility()))
            .await
            .expect("handshake");

        assert_eq!(health.service_id, "service-http-test");
        assert_eq!(health.protocol_version, PROTOCOL_VERSION);
        assert_eq!(handshake.server_revision, 0);
        assert_eq!(handshake.schema_version, 3);
    }

    #[tokio::test]
    async fn incompatible_handshake_maps_to_upgrade_required() {
        let (_directory, state) = state();
        let mut request = compatibility();
        request.protocol_min = 2;
        request.protocol_max = 2;

        let error = handshake(State(state), Json(request))
            .await
            .expect_err("incompatible handshake");
        assert_eq!(error.status, StatusCode::UPGRADE_REQUIRED);
        assert_eq!(error.code, "incompatible_protocol");
    }
}
