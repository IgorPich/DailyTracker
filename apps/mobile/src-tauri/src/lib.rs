#[cfg(target_os = "android")]
use greekgod_mobile_platform::AutoSyncConfig;
use greekgod_mobile_platform::{
    MobilePlatformExt, PlatformError, RestTimerConfig, RestTimerStatus,
};
use greekgod_storage::{
    AuthoritativeStorageStatus, NativeAppDataStore, NativeStorageProbe, StorageError,
    SyncRemoteState, DATABASE_FILENAME,
};
use greekgod_sync_client::{
    LanSyncTransport, MobileSyncEngine, MobileSyncError, MobileSyncReport, PairingInput,
};
use serde::{Deserialize, Serialize};
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

impl std::fmt::Display for MobileCommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl From<StorageError> for MobileCommandError {
    fn from(error: StorageError) -> Self {
        Self::new(error.kind(), error.to_string())
    }
}

impl From<MobileSyncError> for MobileCommandError {
    fn from(error: MobileSyncError) -> Self {
        Self::new(error.code(), error.to_string())
    }
}

impl From<PlatformError> for MobileCommandError {
    fn from(error: PlatformError) -> Self {
        Self::new("platform", error.to_string())
    }
}

fn secret_storage_error(error: PlatformError) -> MobileCommandError {
    MobileCommandError::new("secret_storage", error.to_string())
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileSyncOverviewResponse {
    remotes: Vec<SyncRemoteState>,
    pending_changes: usize,
    daily_conflicts: Vec<greekgod_storage::DailyConflict>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobilePairingResponse {
    service_id: String,
    last_known_host: String,
    pending_changes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileSyncNowResponse {
    report: MobileSyncReport,
    snapshot: MobileSnapshotResponse,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileSyncSelection {
    service_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileTimerStartRequest {
    workout_id: String,
    exercise_id: String,
    set_id: String,
    template_label: String,
    exercise_label: String,
    previous_label: String,
    duration_seconds: u64,
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

async fn sync_once_at(
    store: NativeAppDataStore,
    remote: &SyncRemoteState,
    host: &str,
    device_id: &str,
    token: &str,
    app_version: &str,
) -> Result<MobileSyncReport, MobileSyncError> {
    let transport = LanSyncTransport::pinned(
        host,
        &remote.certificate_fingerprint_sha256,
        device_id,
        token,
    )?;
    MobileSyncEngine::new(store, transport, &remote.service_id, device_id, app_version)?
        .sync_once()
        .await
}

fn schedule_auto_sync(
    app: &AppHandle,
    database_path: &Path,
    service_id: &str,
    device_id: &str,
) -> CommandResult<()> {
    #[cfg(target_os = "android")]
    {
        app.mobile_platform().schedule_auto_sync(AutoSyncConfig {
            database_path: database_path.to_string_lossy().into_owned(),
            service_id: service_id.to_owned(),
            device_id: device_id.to_owned(),
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
        })?;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, database_path, service_id, device_id);
    }
    Ok(())
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
    let response =
        snapshot_response(database_path.clone(), device_id.clone(), applied_operations).await?;
    let remotes = run_native({
        let database_path = database_path.clone();
        move || NativeAppDataStore::new(database_path)?.list_sync_remotes()
    })
    .await?;
    for remote in remotes {
        let _ = schedule_auto_sync(&app, &database_path, &remote.service_id, &device_id);
    }
    Ok(response)
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
    let applied_operations =
        run_native({
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

fn sync_secret_key(service_id: &str) -> String {
    format!("sync:{service_id}")
}

#[tauri::command]
async fn mobile_sync_overview(app: AppHandle) -> CommandResult<MobileSyncOverviewResponse> {
    let database_path = mobile_database_path(&app)?;
    run_native(move || {
        let store = NativeAppDataStore::new(database_path)?;
        Ok(MobileSyncOverviewResponse {
            remotes: store.list_sync_remotes()?,
            pending_changes: store.pending_outbox(1_000)?.len(),
            daily_conflicts: store.daily_conflicts()?,
        })
    })
    .await
}

#[tauri::command]
async fn mobile_pair(
    app: AppHandle,
    pairing: PairingInput,
) -> CommandResult<MobilePairingResponse> {
    let directory = mobile_data_directory(&app)?;
    let device_id = load_or_create_device_id(&directory)?;
    let paired = LanSyncTransport::pair(&pairing, &device_id, "GreekGod Android").await?;
    let service_id = paired.service_id.clone();
    let secret_key = sync_secret_key(&service_id);
    let previous_secret = app
        .mobile_platform()
        .load_secret(&secret_key)
        .map_err(secret_storage_error)?;

    app.mobile_platform()
        .store_secret(&secret_key, &paired.credentials.device_token)
        .map_err(secret_storage_error)?;

    let database_path = mobile_database_path(&app)?;
    let fingerprint = paired.certificate_fingerprint_sha256;
    let host = pairing.base_url;
    let registered = run_native({
        let service_id = service_id.clone();
        let host = host.clone();
        move || {
            let store = NativeAppDataStore::new(database_path)?;
            store.register_sync_remote(&service_id, &fingerprint, &host)?;
            Ok(store.pending_outbox(1_000)?.len())
        }
    })
    .await;

    let pending_changes = match registered {
        Ok(pending) => pending,
        Err(error) => {
            let restored = match previous_secret {
                Some(previous) => app.mobile_platform().store_secret(&secret_key, &previous),
                None => app.mobile_platform().delete_secret(&secret_key),
            };
            if let Err(restore_error) = restored {
                return Err(MobileCommandError::new(
                    "secret_storage",
                    format!(
                        "pairing database failed ({error}); previous Keystore secret could not be restored ({restore_error})"
                    ),
                ));
            }
            return Err(error);
        }
    };
    let _ = schedule_auto_sync(&app, &mobile_database_path(&app)?, &service_id, &device_id);
    Ok(MobilePairingResponse {
        service_id,
        last_known_host: host,
        pending_changes,
    })
}

#[tauri::command]
async fn mobile_sync_now(
    app: AppHandle,
    selection: MobileSyncSelection,
) -> CommandResult<MobileSyncNowResponse> {
    #[cfg(target_os = "android")]
    if !app.mobile_platform().local_network_available()? {
        return Err(MobileCommandError::new(
            "offline",
            "phone is not connected to a local Wi-Fi or Ethernet network",
        ));
    }
    let result = mobile_sync_now_bound(app.clone(), selection).await;
    #[cfg(target_os = "android")]
    {
        let release = app
            .mobile_platform()
            .release_local_network()
            .map_err(MobileCommandError::from);
        if result.is_ok() {
            release?;
        }
    }
    result
}

async fn mobile_sync_now_bound(
    app: AppHandle,
    selection: MobileSyncSelection,
) -> CommandResult<MobileSyncNowResponse> {
    let directory = mobile_data_directory(&app)?;
    let device_id = load_or_create_device_id(&directory)?;
    let database_path = mobile_database_path(&app)?;
    let (store, remote) = run_native({
        let database_path = database_path.clone();
        move || {
            let store = NativeAppDataStore::new(database_path)?;
            let remotes = store.list_sync_remotes()?;
            let remote = match selection.service_id {
                Some(service_id) => remotes
                    .into_iter()
                    .find(|remote| remote.service_id == service_id)
                    .ok_or_else(|| StorageError::InvalidData("paired PC is missing".into()))?,
                None => match remotes.as_slice() {
                    [remote] => remote.clone(),
                    [] => return Err(StorageError::InvalidData("paired PC is missing".into())),
                    _ => {
                        return Err(StorageError::InvalidData(
                            "select a paired PC before syncing".into(),
                        ))
                    }
                },
            };
            Ok((store, remote))
        }
    })
    .await?;

    let token = app
        .mobile_platform()
        .load_secret(&sync_secret_key(&remote.service_id))
        .map_err(secret_storage_error)?
        .ok_or_else(|| MobileCommandError::new("secret_storage", "pairing token is missing"))?;
    let report = match sync_once_at(
        store.clone(),
        &remote,
        &remote.last_known_host,
        &device_id,
        &token,
        env!("CARGO_PKG_VERSION"),
    )
    .await
    {
        Ok(report) => report,
        Err(MobileSyncError::PcUnavailable(_)) => {
            let discovered = app
                .mobile_platform()
                .discover_sync_service(&remote.service_id, 6_000)
                .await
                .map_err(MobileCommandError::from)?
                .ok_or_else(|| {
                    MobileCommandError::new("pc_unavailable", "paired PC is unavailable")
                })?;
            let retry_report = sync_once_at(
                store.clone(),
                &remote,
                &discovered,
                &device_id,
                &token,
                env!("CARGO_PKG_VERSION"),
            )
            .await?;
            let store = store.clone();
            let service_id = remote.service_id.clone();
            let saved_host = discovered.clone();
            run_native(move || {
                if !store.update_sync_remote_host(&service_id, &saved_host)? {
                    return Err(StorageError::InvalidData("paired PC disappeared".into()));
                }
                Ok(())
            })
            .await?;
            retry_report
        }
        Err(error) => return Err(error.into()),
    };
    let snapshot = snapshot_response(database_path, device_id, report.pulled_changes).await?;
    Ok(MobileSyncNowResponse { report, snapshot })
}

#[tauri::command]
async fn mobile_timer_start(
    app: AppHandle,
    request: MobileTimerStartRequest,
) -> CommandResult<RestTimerStatus> {
    let directory = mobile_data_directory(&app)?;
    let device_id = load_or_create_device_id(&directory)?;
    app.mobile_platform()
        .start_rest_timer(RestTimerConfig {
            database_path: mobile_database_path(&app)?.to_string_lossy().into_owned(),
            device_id,
            workout_id: request.workout_id,
            exercise_id: request.exercise_id,
            set_id: request.set_id,
            template_label: request.template_label,
            exercise_label: request.exercise_label,
            previous_label: request.previous_label,
            duration_seconds: request.duration_seconds,
        })
        .map_err(Into::into)
}

#[tauri::command]
async fn mobile_timer_status(app: AppHandle) -> CommandResult<RestTimerStatus> {
    app.mobile_platform()
        .rest_timer_status()
        .map_err(Into::into)
}

#[cfg(any(target_os = "android", test))]
fn record_set_from_lock_screen(
    database_path: &str,
    device_id: &str,
    workout_id: &str,
    exercise_id: &str,
    set_id: &str,
    weight: f64,
    reps: i64,
) -> Result<LockScreenSetResult, StorageError> {
    if database_path.trim().is_empty()
        || device_id.trim().is_empty()
        || !weight.is_finite()
        || weight < 0.0
        || reps <= 0
    {
        return Err(StorageError::InvalidMutation(
            "lock-screen set input is invalid".into(),
        ));
    }
    let store = NativeAppDataStore::new(database_path)?;
    for _attempt in 0..3 {
        let snapshot = store.load_authoritative_snapshot()?;
        let mut data = snapshot.data;
        let workouts = data
            .get_mut("workouts")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| StorageError::InvalidData("workouts array is missing".into()))?;
        let workout = workouts
            .iter_mut()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(workout_id))
            .ok_or_else(|| StorageError::InvalidData("active workout is missing".into()))?;
        let exercise = workout
            .get_mut("exercises")
            .and_then(Value::as_array_mut)
            .and_then(|items| {
                items
                    .iter_mut()
                    .find(|item| item.get("id").and_then(Value::as_str) == Some(exercise_id))
            })
            .ok_or_else(|| StorageError::InvalidData("active exercise is missing".into()))?;
        let sets = exercise
            .get_mut("sets")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| StorageError::InvalidData("active workout sets are missing".into()))?;
        let set_index = sets
            .iter()
            .position(|item| item.get("id").and_then(Value::as_str) == Some(set_id))
            .ok_or_else(|| StorageError::InvalidData("active workout set is missing".into()))?;
        let unchanged = sets[set_index].get("weight").and_then(Value::as_f64) == Some(weight)
            && sets[set_index].get("reps").and_then(Value::as_i64) == Some(reps);
        sets[set_index]["weight"] = serde_json::json!(weight);
        sets[set_index]["reps"] = serde_json::json!(reps);
        let next_set = sets
            .iter()
            .enumerate()
            .skip(set_index + 1)
            .find(|(_, item)| {
                item.get("weight").and_then(Value::as_f64).is_none()
                    || item.get("reps").and_then(Value::as_i64).is_none()
            });
        let result = LockScreenSetResult {
            next_set_id: next_set
                .and_then(|(_, item)| item.get("id"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            next_set_number: next_set
                .map(|(index, _)| index + 1)
                .unwrap_or(set_index + 1),
            set_count: sets.len(),
        };
        if unchanged {
            return Ok(result);
        }
        match store.replace_authoritative_snapshot(&data, device_id, snapshot.revision) {
            Ok(_) => return Ok(result),
            Err(StorageError::Conflict { .. }) => continue,
            Err(error) => return Err(error),
        }
    }
    Err(StorageError::InvalidMutation(
        "lock-screen set input could not acquire a fresh SQLite revision".into(),
    ))
}

#[cfg(any(target_os = "android", test))]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LockScreenSetResult {
    next_set_id: Option<String>,
    next_set_number: usize,
    set_count: usize,
}

#[cfg(target_os = "android")]
fn run_worker_sync(
    database_path: &str,
    service_id: &str,
    device_id: &str,
    app_version: &str,
    token: &str,
    host_override: &str,
) -> Result<(), MobileSyncError> {
    let store = NativeAppDataStore::new(database_path)?;
    let remote = store
        .load_sync_remote(service_id)?
        .ok_or_else(|| MobileSyncError::InvalidConfiguration("paired PC is missing".into()))?;
    let host = if host_override.trim().is_empty() {
        remote.last_known_host.clone()
    } else {
        host_override.to_owned()
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| MobileSyncError::Transport(error.to_string()))?;
    runtime.block_on(sync_once_at(
        store.clone(),
        &remote,
        &host,
        device_id,
        token,
        app_version,
    ))?;
    if !host_override.trim().is_empty() {
        store.update_sync_remote_host(service_id, host_override)?;
    }
    Ok(())
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_igorpich_greekgod_mobileplatform_GreekGodSyncWorker_nativeSync(
    mut env: jni::JNIEnv<'_>,
    _class: jni::objects::JClass<'_>,
    database_path: jni::objects::JString<'_>,
    service_id: jni::objects::JString<'_>,
    device_id: jni::objects::JString<'_>,
    app_version: jni::objects::JString<'_>,
    token: jni::objects::JString<'_>,
    host_override: jni::objects::JString<'_>,
) -> jni::sys::jstring {
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let read = |env: &mut jni::JNIEnv<'_>, value: &jni::objects::JString<'_>| {
            env.get_string(value)
                .map(String::from)
                .map_err(|error| error.to_string())
        };
        let database_path = read(&mut env, &database_path)?;
        let service_id = read(&mut env, &service_id)?;
        let device_id = read(&mut env, &device_id)?;
        let app_version = read(&mut env, &app_version)?;
        let token = read(&mut env, &token)?;
        let host_override = read(&mut env, &host_override)?;
        run_worker_sync(
            &database_path,
            &service_id,
            &device_id,
            &app_version,
            &token,
            &host_override,
        )
        .map_err(|error| error.code().to_owned())
    }));
    let code = match outcome {
        Ok(Ok(())) => "ok".to_owned(),
        Ok(Err(code)) => code,
        Err(_) => "native_panic".to_owned(),
    };
    env.new_string(code)
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_igorpich_greekgod_mobileplatform_GreekGodActionReceiver_nativeRecordSet(
    mut env: jni::JNIEnv<'_>,
    _class: jni::objects::JClass<'_>,
    database_path: jni::objects::JString<'_>,
    device_id: jni::objects::JString<'_>,
    workout_id: jni::objects::JString<'_>,
    exercise_id: jni::objects::JString<'_>,
    set_id: jni::objects::JString<'_>,
    weight: jni::sys::jdouble,
    reps: jni::sys::jint,
) -> jni::sys::jstring {
    let saved = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let read = |env: &mut jni::JNIEnv<'_>, value: &jni::objects::JString<'_>| {
            env.get_string(value).map(String::from).ok()
        };
        let result = record_set_from_lock_screen(
            &read(&mut env, &database_path)?,
            &read(&mut env, &device_id)?,
            &read(&mut env, &workout_id)?,
            &read(&mut env, &exercise_id)?,
            &read(&mut env, &set_id)?,
            weight,
            i64::from(reps),
        )
        .ok()?;
        serde_json::to_string(&result).ok()
    }))
    .ok()
    .flatten();
    saved
        .and_then(|value| env.new_string(value).ok())
        .map(|value| value.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(greekgod_mobile_platform::init())
        .invoke_handler(tauri::generate_handler![
            mobile_storage_initialize,
            mobile_storage_load,
            mobile_storage_replace,
            mobile_storage_status,
            mobile_sync_overview,
            mobile_pair,
            mobile_sync_now,
            mobile_timer_start,
            mobile_timer_status,
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

    #[test]
    fn lock_screen_set_write_is_durable_atomic_and_idempotent() {
        let directory = tempdir().expect("temporary lock-screen database");
        let database_path = directory.path().join(DATABASE_FILENAME);
        let store = NativeAppDataStore::new(&database_path).expect("mobile SQLite");
        store
            .bootstrap_from_legacy_snapshot(
                &json!({
                    "version": 4,
                    "dailyEntries": [],
                    "workouts": [{
                        "id": "workout-lock", "date": "2026-08-27", "templateId": "push",
                        "templateCode": "A", "templateName": "PUSH",
                        "exercises": [{
                            "id": "exercise-lock", "exerciseId": "bench-press",
                            "name": "Bench Press", "sets": [
                                { "id": "set-lock" }, { "id": "set-next" }
                            ]
                        }]
                    }],
                    "templates": [], "exerciseLibrary": [],
                    "settings": { "gymLocations": [] }, "coachNotes": {}
                }),
                "mobile:test",
            )
            .expect("bootstrap lock-screen fixture");
        drop(store);

        let path = database_path.to_string_lossy();
        let first = record_set_from_lock_screen(
            &path,
            "mobile:test",
            "workout-lock",
            "exercise-lock",
            "set-lock",
            34.5,
            8,
        )
        .expect("first notification event");
        assert_eq!(first.next_set_id.as_deref(), Some("set-next"));
        assert_eq!(first.next_set_number, 2);
        assert_eq!(first.set_count, 2);
        record_set_from_lock_screen(
            &path,
            "mobile:test",
            "workout-lock",
            "exercise-lock",
            "set-lock",
            34.5,
            8,
        )
        .expect("duplicate notification event");

        let reopened = NativeAppDataStore::new(&database_path).expect("reopen after process death");
        let snapshot = reopened.load_authoritative_snapshot().expect("durable set");
        assert_eq!(
            snapshot.data["workouts"][0]["exercises"][0]["sets"][0]["weight"],
            34.5
        );
        assert_eq!(
            snapshot.data["workouts"][0]["exercises"][0]["sets"][0]["reps"],
            8
        );
        assert_eq!(
            reopened
                .pending_outbox(100)
                .expect("single outbox mutation")
                .len(),
            1
        );
    }
}
