use greekgod_storage::{
    AuthoritativeStorageStatus, NativeAppDataStore, NativeStorageProbe, StorageError,
    DATABASE_FILENAME,
};
use serde::Serialize;
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileCommandError {
    kind: String,
    message: String,
}

impl MobileCommandError {
    fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
        }
    }
}

impl From<StorageError> for MobileCommandError {
    fn from(error: StorageError) -> Self {
        Self::new(error.kind(), error.to_string())
    }
}

type CommandResult<T> = Result<T, MobileCommandError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileSnapshotResponse {
    data: Value,
    revision: i64,
    applied_operations: usize,
    pending_changes: usize,
    device_id: String,
    probe: NativeStorageProbe,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileStorageStatusResponse {
    authority: AuthoritativeStorageStatus,
    pending_changes: usize,
    device_id: String,
    probe: NativeStorageProbe,
}

fn mobile_data_directory(app: &AppHandle) -> CommandResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|error| MobileCommandError::new("app-data-directory", error.to_string()))
}

fn mobile_database_path(app: &AppHandle) -> CommandResult<PathBuf> {
    Ok(mobile_data_directory(app)?.join(DATABASE_FILENAME))
}

fn load_or_create_device_id(directory: &Path) -> CommandResult<String> {
    fs::create_dir_all(directory)
        .map_err(|error| MobileCommandError::new("device-identity", error.to_string()))?;
    let path = directory.join("mobile-device-id");
    if path.exists() {
        let value = fs::read_to_string(&path)
            .map_err(|error| MobileCommandError::new("device-identity", error.to_string()))?;
        let value = value.trim();
        if value.starts_with("mobile:") && value.len() > "mobile:".len() {
            return Ok(value.to_owned());
        }
        return Err(MobileCommandError::new(
            "device-identity",
            "persisted mobile device identity is invalid",
        ));
    }

    let device_id = format!("mobile:{}", uuid::Uuid::new_v4());
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| MobileCommandError::new("device-identity", error.to_string()))?;
    file.write_all(device_id.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|error| MobileCommandError::new("device-identity", error.to_string()))?;
    Ok(device_id)
}

async fn run_native<T, F>(operation: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, StorageError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| MobileCommandError::new("native-task", error.to_string()))?
        .map_err(Into::into)
}

async fn snapshot_response(
    database_path: PathBuf,
    device_id: String,
    applied_operations: usize,
) -> CommandResult<MobileSnapshotResponse> {
    run_native(move || {
        let store = NativeAppDataStore::new(database_path)?;
        let snapshot = store.load_authoritative_snapshot()?;
        let pending_changes = store.pending_outbox(1_000)?.len();
        Ok(MobileSnapshotResponse {
            data: snapshot.data,
            revision: snapshot.revision,
            applied_operations,
            pending_changes,
            device_id,
            probe: store.probe()?,
        })
    })
    .await
}

#[tauri::command]
async fn mobile_storage_initialize(
    app: AppHandle,
    initial_data: Value,
) -> CommandResult<MobileSnapshotResponse> {
    let directory = mobile_data_directory(&app)?;
    let device_id = load_or_create_device_id(&directory)?;
    let database_path = mobile_database_path(&app)?;
    let bootstrap_device_id = device_id.clone();
    let applied_operations = run_native({
        let database_path = database_path.clone();
        move || {
            let store = NativeAppDataStore::new(database_path)?;
            let status = store.authoritative_status()?;
            if !status.bootstrapped {
                store.bootstrap_from_legacy_snapshot(&initial_data, &bootstrap_device_id)?;
            }
            Ok(0_usize)
        }
    })
    .await?;
    snapshot_response(database_path, device_id, applied_operations).await
}

#[tauri::command]
async fn mobile_storage_load(app: AppHandle) -> CommandResult<MobileSnapshotResponse> {
    let directory = mobile_data_directory(&app)?;
    let device_id = load_or_create_device_id(&directory)?;
    snapshot_response(mobile_database_path(&app)?, device_id, 0).await
}

#[tauri::command]
async fn mobile_storage_replace(
    app: AppHandle,
    data: Value,
    expected_revision: i64,
) -> CommandResult<MobileSnapshotResponse> {
    let directory = mobile_data_directory(&app)?;
    let device_id = load_or_create_device_id(&directory)?;
    let database_path = mobile_database_path(&app)?;
    let write_device_id = device_id.clone();
    let applied_operations = run_native({
        let database_path = database_path.clone();
        move || {
            let replaced = NativeAppDataStore::new(database_path)?
                .replace_authoritative_snapshot(&data, &write_device_id, expected_revision)?;
            Ok(replaced.applied_operations)
        }
    })
    .await?;
    snapshot_response(database_path, device_id, applied_operations).await
}

#[tauri::command]
async fn mobile_storage_status(app: AppHandle) -> CommandResult<MobileStorageStatusResponse> {
    let directory = mobile_data_directory(&app)?;
    let device_id = load_or_create_device_id(&directory)?;
    let database_path = mobile_database_path(&app)?;
    run_native(move || {
        let store = NativeAppDataStore::new(database_path)?;
        Ok(MobileStorageStatusResponse {
            authority: store.authoritative_status()?,
            pending_changes: store.pending_outbox(1_000)?.len(),
            device_id,
            probe: store.probe()?,
        })
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            mobile_storage_initialize,
            mobile_storage_load,
            mobile_storage_replace,
            mobile_storage_status,
        ])
        .run(tauri::generate_context!())
        .expect("failed to initialize GreekGod mobile");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn device_identity_is_persistent_and_not_a_secret() {
        let directory = tempdir().expect("temporary app data");
        let first = load_or_create_device_id(directory.path()).expect("first identity");
        let second = load_or_create_device_id(directory.path()).expect("persisted identity");
        assert_eq!(first, second);
        assert!(first.starts_with("mobile:"));
    }

    #[test]
    fn offline_snapshot_write_persists_to_sqlite_and_outbox_before_any_network() {
        let directory = tempdir().expect("temporary mobile database");
        let database_path = directory.path().join(DATABASE_FILENAME);
        let store = NativeAppDataStore::new(&database_path).expect("mobile SQLite");
        let initial = json!({
            "version": 4,
            "dailyEntries": [],
            "workouts": [],
            "templates": [],
            "exerciseLibrary": [],
            "settings": {
                "phase": "Maintenance",
                "calorieTarget": 2800,
                "proteinTarget": 160,
                "trendThresholds": {
                    "lossBelow": -0.15,
                    "stableUpper": 0.05,
                    "slowGainUpper": 0.2
                }
            },
            "coachNotes": {}
        });
        store
            .bootstrap_from_legacy_snapshot(&initial, "mobile:test")
            .expect("mobile bootstrap");
        let bootstrapped = store
            .load_authoritative_snapshot()
            .expect("bootstrapped snapshot");
        let mut edited = bootstrapped.data;
        edited["workouts"] = json!([{
            "id": "mobile-offline-workout",
            "date": "2026-08-27",
            "templateId": "push",
            "templateCode": "A",
            "templateName": "PUSH",
            "exercises": []
        }]);

        let saved = store
            .replace_authoritative_snapshot(&edited, "mobile:test", bootstrapped.revision)
            .expect("offline save");
        assert_eq!(saved.applied_operations, 1);
        assert_eq!(store.pending_outbox(100).expect("outbox").len(), 1);

        drop(store);
        let reopened = NativeAppDataStore::new(database_path).expect("reopened mobile SQLite");
        let loaded = reopened
            .load_authoritative_snapshot()
            .expect("persisted mobile snapshot");
        assert_eq!(loaded.data["workouts"][0]["id"], "mobile-offline-workout");
        assert_eq!(loaded.revision, saved.revision);
    }
}
