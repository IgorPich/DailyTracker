use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

use crate::offline_ai_pack;

const RUNTIME_VERSION: &str = "llama.cpp-b10760-0f3a71be15af836d277c9f918adfafb45732677e";
const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub struct ManagedRuntimeState {
    shared: Arc<(Mutex<RuntimeLifecycle>, Condvar)>,
    idle_timeout: Duration,
}

pub struct ManagedAiPackInstallState {
    importing: AtomicBool,
    cancel: Arc<AtomicBool>,
}
impl Default for ManagedAiPackInstallState {
    fn default() -> Self {
        Self {
            importing: AtomicBool::new(false),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}
impl Default for ManagedRuntimeState {
    fn default() -> Self {
        Self::with_idle_timeout(DEFAULT_IDLE_TIMEOUT)
    }
}
impl ManagedRuntimeState {
    fn with_idle_timeout(idle_timeout: Duration) -> Self {
        Self {
            shared: Arc::new((Mutex::new(RuntimeLifecycle::default()), Condvar::new())),
            idle_timeout,
        }
    }
}
#[derive(Default)]
struct RuntimeLifecycle {
    process: Option<ManagedProcess>,
    phase: LifecyclePhase,
    queued: usize,
    active: bool,
    generation: u64,
    has_run: bool,
    shutting_down: bool,
    last_failure: Option<String>,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum LifecyclePhase {
    #[default]
    Unloaded,
    Starting,
    Warm,
    Active,
    Stopping,
    Failed,
}
struct ManagedProcess {
    child: Child,
    endpoint: String,
    token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedStatus {
    state: &'static str,
    runtime_version: &'static str,
    detail: String,
    endpoint: Option<String>,
    asset_root: Option<String>,
    installation: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedInferenceRequest {
    prompt_version: String,
    system: String,
    input: String,
    json_schema: Value,
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let production = app.config().identifier == "com.igorpich.formlog";
    if !production {
        if let Some(value) = std::env::var_os("GREEKGOD_MANAGED_RUNTIME_ROOT") {
            return Ok(PathBuf::from(value));
        }
    }
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("companion-managed-runtime"))
        .map_err(|error| error.to_string())
}
#[derive(Debug)]
struct AssetPaths {
    root: PathBuf,
    runtime: PathBuf,
    model: PathBuf,
}
fn verify(app: &AppHandle) -> Result<AssetPaths, ManagedStatus> {
    let managed_root = root(app).map_err(|detail| status("FAILED", detail, None, None))?;
    match offline_ai_pack::active_pack(&managed_root) {
        Ok(pack) => Ok(AssetPaths {
            root: pack.root,
            runtime: pack.runtime,
            model: pack.model,
        }),
        Err(error) if error.code == "ACTIVE_PACK_MISSING" => {
            let legacy_model = managed_root
                .join("models")
                .join("Phi-3.5-mini-instruct-Q4_0.gguf");
            let legacy_exists = legacy_model.is_file();
            Err(status(
                if legacy_exists {
                    "MODEL_OUTDATED"
                } else {
                    "MODEL_MISSING"
                },
                if legacy_exists {
                    "Wykryto starszy ręczny zasób AI. Zainstaluj zatwierdzony GreekGod Offline AI Pack; stary plik nie został usunięty.".into()
                } else {
                    "Zatwierdzony opcjonalny GreekGod Offline AI Pack nie jest zainstalowany."
                        .into()
                },
                None,
                Some(managed_root.display().to_string()),
            ))
        }
        Err(error) => Err(status(
            error.code,
            error.detail,
            None,
            Some(managed_root.display().to_string()),
        )),
    }
}
fn status(
    state: &'static str,
    detail: String,
    endpoint: Option<String>,
    asset_root: Option<String>,
) -> ManagedStatus {
    ManagedStatus {
        state,
        runtime_version: RUNTIME_VERSION,
        detail,
        endpoint,
        asset_root,
        installation: "OFFLINE_PACK",
    }
}
fn token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn request(endpoint: &str, token: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    request_with_timeout(endpoint, token, path, body, Duration::from_secs(30))
}
fn request_with_timeout(
    endpoint: &str,
    token: &str,
    path: &str,
    body: Option<Value>,
    timeout: Duration,
) -> Result<Value, String> {
    let url = format!("{endpoint}{path}");
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        .build()
        .new_agent();
    let response = if let Some(value) = body {
        agent
            .post(&url)
            .header("Authorization", &format!("Bearer {token}"))
            .send_json(value)
    } else {
        agent
            .get(&url)
            .header("Authorization", &format!("Bearer {token}"))
            .call()
    }
    .map_err(|error| format!("managed sidecar request failed: {error}"))?;
    response
        .into_body()
        .read_json::<Value>()
        .map_err(|error| format!("invalid sidecar response: {error}"))
}
fn owned_ready(process: &ManagedProcess) -> bool {
    let timeout = Duration::from_millis(500);
    request_with_timeout(
        &process.endpoint,
        &process.token,
        "/v1/models",
        None,
        timeout,
    )
    .is_ok()
        && request_with_timeout(
            &process.endpoint,
            "invalid-greekgod-instance-token",
            "/v1/models",
            None,
            timeout,
        )
        .is_err()
        && request_with_timeout(&process.endpoint, &process.token, "/health", None, timeout)
            .ok()
            .and_then(|value| {
                value
                    .get("status")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .as_deref()
            == Some("ok")
}
fn shutdown_process(process: &mut ManagedProcess) {
    let _ = request_with_timeout(
        &process.endpoint,
        &process.token,
        "/shutdown",
        Some(json!({})),
        Duration::from_secs(2),
    );
    let until = Instant::now() + Duration::from_secs(2);
    while Instant::now() < until {
        if matches!(process.child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = process.child.kill();
    let _ = process.child.wait();
}
fn ensure_started(app: &AppHandle, lifecycle: &mut RuntimeLifecycle) -> Result<(), String> {
    if let Some(process) = lifecycle.process.as_mut() {
        if process
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
            && owned_ready(process)
        {
            return Ok(());
        }
        shutdown_process(process);
        lifecycle.process = None;
    }
    let assets = verify(app).map_err(|value| value.detail)?;
    start_verified(lifecycle, assets)
}
fn start_verified(lifecycle: &mut RuntimeLifecycle, assets: AssetPaths) -> Result<(), String> {
    lifecycle.phase = LifecyclePhase::Starting;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    drop(listener);
    let secret = token()?;
    let endpoint = format!("http://127.0.0.1:{port}");
    let mut command = Command::new(assets.runtime.join("llama-server.exe"));
    command
        .current_dir(&assets.runtime)
        .args([
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--model",
        ])
        .arg(&assets.model)
        .args([
            "--n-gpu-layers",
            "99",
            "--ctx-size",
            "4096",
            "--parallel",
            "1",
            "--no-webui",
            "--offline",
            "--cors-origins",
            "localhost",
            "--log-disable",
        ])
        .env("LLAMA_API_KEY", &secret)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command
        .spawn()
        .map_err(|error| format!("managed sidecar start failed: {error}"))?;
    let mut process = ManagedProcess {
        child,
        endpoint,
        token: secret,
    };
    let until = Instant::now() + Duration::from_secs(25);
    while Instant::now() < until {
        if process
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Err("managed sidecar exited during startup".into());
        }
        if owned_ready(&process) {
            lifecycle.process = Some(process);
            lifecycle.has_run = true;
            lifecycle.phase = LifecyclePhase::Warm;
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    shutdown_process(&mut process);
    Err("managed sidecar startup timed out".into())
}

fn schedule_idle_shutdown(state: &ManagedRuntimeState, generation: u64) {
    let shared = Arc::clone(&state.shared);
    let timeout = state.idle_timeout;
    thread::spawn(move || {
        thread::sleep(timeout);
        let (lock, wake) = &*shared;
        let mut lifecycle = match lock.lock() {
            Ok(value) => value,
            Err(_) => return,
        };
        if !idle_shutdown_eligible(&lifecycle, generation) {
            return;
        }
        lifecycle.phase = LifecyclePhase::Stopping;
        let mut process = lifecycle.process.take();
        drop(lifecycle);
        if let Some(process) = process.as_mut() {
            shutdown_process(process);
        }
        let mut lifecycle = match lock.lock() {
            Ok(value) => value,
            Err(_) => return,
        };
        if !lifecycle.shutting_down {
            lifecycle.phase = LifecyclePhase::Unloaded;
        }
        wake.notify_all();
    });
}

fn idle_shutdown_eligible(lifecycle: &RuntimeLifecycle, generation: u64) -> bool {
    !lifecycle.shutting_down
        && lifecycle.generation == generation
        && !lifecycle.active
        && lifecycle.queued == 0
        && lifecycle.process.is_some()
}

fn lifecycle_status(app: &AppHandle, lifecycle: &mut RuntimeLifecycle) -> ManagedStatus {
    let asset_root = root(app).ok().map(|value| value.display().to_string());
    if lifecycle.shutting_down {
        return status(
            "STOPPING",
            "Managed runtime is stopping".into(),
            None,
            asset_root,
        );
    }
    if lifecycle.active {
        return status(
            "INFERENCE_ACTIVE",
            "Local inference is active".into(),
            lifecycle
                .process
                .as_ref()
                .map(|value| value.endpoint.clone()),
            asset_root,
        );
    }
    match lifecycle.phase {
        LifecyclePhase::Starting => {
            return status(
                "STARTING",
                "Local model is starting and loading".into(),
                None,
                asset_root,
            )
        }
        LifecyclePhase::Stopping => {
            return status(
                "STOPPING",
                "Idle managed runtime is stopping".into(),
                None,
                asset_root,
            )
        }
        LifecyclePhase::Failed => {
            return status(
                "FAILED",
                lifecycle
                    .last_failure
                    .clone()
                    .unwrap_or_else(|| "Managed runtime failed safely".into()),
                None,
                asset_root,
            )
        }
        LifecyclePhase::Warm => {
            if let Some(process) = lifecycle.process.as_mut() {
                if process.child.try_wait().ok().flatten().is_none() && owned_ready(process) {
                    return status(
                        "READY_WARM",
                        "Local model is loaded and ready".into(),
                        Some(process.endpoint.clone()),
                        asset_root,
                    );
                }
                shutdown_process(process);
                lifecycle.process = None;
                lifecycle.phase = LifecyclePhase::Failed;
                lifecycle.last_failure = Some("Managed sidecar exited or became unhealthy".into());
                return status(
                    "FAILED",
                    lifecycle.last_failure.clone().unwrap(),
                    None,
                    asset_root,
                );
            }
        }
        LifecyclePhase::Unloaded | LifecyclePhase::Active => {}
    }
    match verify(app) {
        Ok(paths) => status(
            if lifecycle.has_run {
                "IDLE_UNLOADED"
            } else {
                "READY_UNLOADED"
            },
            if lifecycle.has_run {
                "Local model was unloaded after inactivity".into()
            } else {
                "Verified assets; model loads on first AI request".into()
            },
            None,
            Some(paths.root.display().to_string()),
        ),
        Err(value) => value,
    }
}

#[tauri::command]
pub async fn managed_companion_status(
    app: AppHandle,
    state: tauri::State<'_, ManagedRuntimeState>,
) -> Result<ManagedStatus, String> {
    let shared = Arc::clone(&state.shared);
    tauri::async_runtime::spawn_blocking(move || {
        let (lock, _) = &*shared;
        let mut lifecycle = lock
            .lock()
            .map_err(|_| "managed runtime lock poisoned".to_string())?;
        Ok(lifecycle_status(&app, &mut lifecycle))
    })
    .await
    .map_err(|error| format!("managed runtime task failed: {error}"))?
}

#[tauri::command]
pub async fn managed_companion_infer(
    app: AppHandle,
    state: tauri::State<'_, ManagedRuntimeState>,
    request_data: ManagedInferenceRequest,
) -> Result<String, String> {
    let supported_contract = matches!(
        request_data.prompt_version.as_str(),
        "greekgod-trainer-v2"
            | "greekgod-dialogue-v2"
            | "greekgod-memory-v2"
            | "greekgod-command-v2"
    );
    if !supported_contract
        || request_data.system.len() > 20_000
        || request_data.input.len() > 100_000
        || !request_data.json_schema.is_object()
    {
        return Err("invalid bounded inference request".into());
    }
    let shared = Arc::clone(&state.shared);
    let idle_timeout = state.idle_timeout;
    {
        let (lock, _) = &*shared;
        let mut lifecycle = lock
            .lock()
            .map_err(|_| "managed runtime lock poisoned".to_string())?;
        if lifecycle.shutting_down {
            return Err("managed runtime is shutting down".into());
        }
        lifecycle.queued = lifecycle.queued.saturating_add(1);
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let (lock, wake) = &*shared;
        let mut lifecycle = lock.lock().map_err(|_| "managed runtime lock poisoned".to_string())?;
        while lifecycle.active || lifecycle.phase == LifecyclePhase::Stopping {
            if lifecycle.shutting_down { lifecycle.queued = lifecycle.queued.saturating_sub(1); return Err("managed runtime is shutting down".into()); }
            lifecycle = wake.wait(lifecycle).map_err(|_| "managed runtime lock poisoned".to_string())?;
        }
        lifecycle.queued = lifecycle.queued.saturating_sub(1);
        if lifecycle.shutting_down { return Err("managed runtime is shutting down".into()); }
        if let Err(error) = ensure_started(&app, &mut lifecycle) {
            lifecycle.phase = LifecyclePhase::Failed; lifecycle.last_failure = Some(error.clone()); lifecycle.generation = lifecycle.generation.wrapping_add(1); wake.notify_all(); return Err(error);
        }
        lifecycle.active = true; lifecycle.phase = LifecyclePhase::Active;
        let (endpoint, token) = lifecycle.process.as_ref().map(|process| (process.endpoint.clone(), process.token.clone()))
            .ok_or_else(|| "managed runtime unavailable".to_string())?;
        drop(lifecycle);
        let prompt = format!("<|system|>\n[greekgod-companion-v1] [{}] {}<|end|>\n<|user|>\n{}<|end|>\n<|assistant|>\n", request_data.prompt_version, request_data.system, request_data.input);
        let body = json!({"prompt":prompt,"n_predict":512,"temperature":0,"seed":42,"top_k":40,"top_p":0.9,"min_p":0.1,"repeat_last_n":64,"repeat_penalty":1,"presence_penalty":0,"frequency_penalty":0,"stop":["<|system|>","<|user|>","<|end|>","<|assistant|>"],"json_schema":request_data.json_schema});
        let response = request(&endpoint, &token, "/completion", Some(body))
            .and_then(|value| value.get("content").and_then(Value::as_str).map(str::to_owned).ok_or_else(|| "incomplete managed sidecar response".into()));
        let mut lifecycle = lock.lock().map_err(|_| "managed runtime lock poisoned".to_string())?;
        lifecycle.active = false; lifecycle.generation = lifecycle.generation.wrapping_add(1);
        if lifecycle.shutting_down { lifecycle.phase = LifecyclePhase::Stopping; }
        else if lifecycle.process.is_some() { lifecycle.phase = LifecyclePhase::Warm; lifecycle.last_failure = response.as_ref().err().cloned(); }
        else { lifecycle.phase = LifecyclePhase::Failed; lifecycle.last_failure = Some("Managed sidecar stopped during inference".into()); }
        let generation = lifecycle.generation; wake.notify_all();
        Ok((response, generation))
    }).await.map_err(|error| format!("managed runtime task failed: {error}"))??;
    let timer_state = ManagedRuntimeState {
        shared: Arc::clone(&state.shared),
        idle_timeout,
    };
    schedule_idle_shutdown(&timer_state, result.1);
    result.0
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPackInstallResult {
    pack_id: String,
    pack_version: String,
    model_sha256: String,
    installed_root: String,
    installed_bytes: u64,
}

#[tauri::command]
pub async fn managed_ai_pack_install(
    app: AppHandle,
    runtime_state: tauri::State<'_, ManagedRuntimeState>,
    install_state: tauri::State<'_, ManagedAiPackInstallState>,
    source_root: String,
) -> Result<AiPackInstallResult, String> {
    if install_state
        .importing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("IMPORT_BUSY: Inny import pakietu AI już trwa.".into());
    }
    install_state.cancel.store(false, Ordering::SeqCst);
    {
        let (lock, wake) = &*runtime_state.shared;
        let mut lifecycle = lock
            .lock()
            .map_err(|_| "managed runtime lock poisoned".to_string())?;
        if lifecycle.active || lifecycle.queued > 0 || lifecycle.phase == LifecyclePhase::Starting {
            install_state.importing.store(false, Ordering::SeqCst);
            return Err("RUNTIME_BUSY: Poczekaj na zakończenie lokalnego wnioskowania.".into());
        }
        let mut process = lifecycle.process.take();
        lifecycle.phase = LifecyclePhase::Stopping;
        drop(lifecycle);
        if let Some(process) = process.as_mut() {
            shutdown_process(process);
        }
        if let Ok(mut lifecycle) = lock.lock() {
            lifecycle.phase = LifecyclePhase::Unloaded;
            lifecycle.last_failure = None;
            wake.notify_all();
        }
    }
    let managed_root = match root(&app) {
        Ok(value) => value,
        Err(error) => {
            install_state.importing.store(false, Ordering::SeqCst);
            return Err(error);
        }
    };
    let source = PathBuf::from(source_root);
    let cancel = Arc::clone(&install_state.cancel);
    let app_for_progress = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        offline_ai_pack::install_pack(&source, &managed_root, &cancel, &|progress| {
            let _ = app_for_progress.emit("managed-ai-pack-progress", progress);
        })
    })
    .await
    .map_err(|error| format!("IMPORT_TASK_FAILED: {error}"));
    install_state.importing.store(false, Ordering::SeqCst);
    let installed = result
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let contract = offline_ai_pack::expected_contract();
    Ok(AiPackInstallResult {
        pack_id: contract.pack_id,
        pack_version: contract.pack_version,
        model_sha256: contract.model.sha256,
        installed_root: installed.root.display().to_string(),
        installed_bytes: offline_ai_pack::total_install_bytes(),
    })
}

#[tauri::command]
pub fn managed_ai_pack_cancel_import(
    state: tauri::State<'_, ManagedAiPackInstallState>,
) -> Result<(), String> {
    if !state.importing.load(Ordering::SeqCst) {
        return Err("IMPORT_NOT_RUNNING: Brak aktywnego importu.".into());
    }
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

pub fn shutdown(state: &ManagedRuntimeState) {
    let (lock, wake) = &*state.shared;
    let mut lifecycle = match lock.lock() {
        Ok(value) => value,
        Err(_) => return,
    };
    lifecycle.shutting_down = true;
    lifecycle.generation = lifecycle.generation.wrapping_add(1);
    lifecycle.phase = LifecyclePhase::Stopping;
    let mut process = lifecycle.process.take();
    drop(lifecycle);
    if let Some(process) = process.as_mut() {
        shutdown_process(process);
    }
    if let Ok(mut lifecycle) = lock.lock() {
        lifecycle.active = false;
        lifecycle.phase = LifecyclePhase::Unloaded;
        wake.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_policy_is_five_minutes_and_startup_is_unloaded() {
        let state = ManagedRuntimeState::default();
        assert_eq!(state.idle_timeout, Duration::from_secs(300));
        let (lock, _) = &*state.shared;
        let lifecycle = lock.lock().unwrap();
        assert!(lifecycle.process.is_none());
        assert_eq!(lifecycle.phase, LifecyclePhase::Unloaded);
        assert!(!lifecycle.active);
        assert_eq!(lifecycle.queued, 0);
    }

    #[test]
    fn active_queued_stale_and_shutdown_states_cannot_idle_stop() {
        let mut lifecycle = RuntimeLifecycle::default();
        lifecycle.process = Some(test_process());
        lifecycle.generation = 7;
        lifecycle.active = true;
        assert!(!idle_shutdown_eligible(&lifecycle, 7));
        lifecycle.active = false;
        lifecycle.queued = 1;
        assert!(!idle_shutdown_eligible(&lifecycle, 7));
        lifecycle.queued = 0;
        assert!(!idle_shutdown_eligible(&lifecycle, 6));
        lifecycle.shutting_down = true;
        assert!(!idle_shutdown_eligible(&lifecycle, 7));
        lifecycle.shutting_down = false;
        assert!(idle_shutdown_eligible(&lifecycle, 7));
        if let Some(mut process) = lifecycle.process.take() {
            let _ = process.child.wait();
        }
    }

    #[test]
    fn configured_idle_timer_stops_owned_process_and_marks_unloaded() {
        let state = ManagedRuntimeState::with_idle_timeout(Duration::from_millis(20));
        let (lock, _) = &*state.shared;
        {
            let mut lifecycle = lock.lock().unwrap();
            lifecycle.process = Some(test_process());
            lifecycle.phase = LifecyclePhase::Warm;
            lifecycle.generation = 3;
        }
        schedule_idle_shutdown(&state, 3);
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            {
                let lifecycle = lock.lock().unwrap();
                if lifecycle.phase == LifecyclePhase::Unloaded {
                    assert!(lifecycle.process.is_none());
                    break;
                }
            }
            assert!(Instant::now() < deadline, "idle shutdown did not complete");
            thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn external_pinned_runtime_start_reuse_idle_restart_crash_and_asset_failures() {
        let Some(root) = std::env::var_os("GREEKGOD_MANAGED_RUNTIME_TEST_ROOT").map(PathBuf::from)
        else {
            return;
        };
        let assets = verified_pack_assets(&root).expect("isolated pinned AI Pack must verify");
        let mut lifecycle = RuntimeLifecycle::default();
        start_verified(&mut lifecycle, assets).expect("first start");
        let first = lifecycle
            .process
            .as_ref()
            .map(|value| {
                (
                    value.child.id(),
                    value.endpoint.clone(),
                    value.token.clone(),
                )
            })
            .unwrap();
        assert!(owned_ready(lifecycle.process.as_ref().unwrap()));
        ensure_started_assets(&mut lifecycle, &root).expect("ready runtime must be reused");
        assert_eq!(
            lifecycle.process.as_ref().unwrap().child.id(),
            first.0,
            "ready runtime must not spawn a duplicate sidecar"
        );

        let process = lifecycle.process.as_ref().unwrap();
        let fact = "Ostatnie 30 dni — treningi: 3; z zapisanym czasem: 3; łącznie: 135 min.";
        let prompt = format!("<|system|>\n[greekgod-companion-v1] [greekgod-dialogue-v2] Jesteś modułem odpowiedzi tylko do odczytu. Odpowiedz krótko po polsku na pytanie, używając wartości z evidence. Zwróć wyłącznie JSON.<|end|>\n<|user|>\n{{\"kind\":\"COMPANION_READ_ONLY\",\"input\":{{\"kind\":\"USER_DIALOGUE\",\"text\":\"Ile treningów wykonałem w ostatnich 30 dniach?\"}},\"evidence\":[{{\"id\":\"evidence-1\",\"text\":\"{fact}\"}}],\"mutationLike\":false}}<|end|>\n<|assistant|>\n");
        let body = json!({"prompt":prompt,"n_predict":512,"temperature":0,"seed":42,"top_k":40,"top_p":0.9,"min_p":0.1,"repeat_last_n":64,"repeat_penalty":1,"presence_penalty":0,"frequency_penalty":0,"stop":["<|system|>","<|user|>","<|end|>","<|assistant|>"],"json_schema":{
            "type":"object","additionalProperties":false,"required":["message","evidenceUses","mutationStatus"],"properties":{
                "message":{"type":"string"},"evidenceUses":{"type":"array","minItems":1,"maxItems":1,"items":{"type":"object","additionalProperties":false,"required":["id","fact"],"properties":{"id":{"const":"evidence-1"},"fact":{"const":fact}}}},"mutationStatus":{"const":"NOT_APPLICABLE"}
            }
        }});
        let value = request(&process.endpoint, &process.token, "/completion", Some(body))
            .expect("cold synthetic inference must complete");
        let content = value
            .get("content")
            .and_then(Value::as_str)
            .expect("cold synthetic inference content");
        let parsed: Value =
            serde_json::from_str(content).expect("cold synthetic inference must return JSON");
        assert_eq!(parsed["evidenceUses"][0]["id"], "evidence-1");
        assert_eq!(parsed["evidenceUses"][0]["fact"], fact);
        assert_eq!(parsed["mutationStatus"], "NOT_APPLICABLE");

        let state = ManagedRuntimeState::with_idle_timeout(Duration::from_millis(100));
        {
            let (lock, _) = &*state.shared;
            let mut slot = lock.lock().unwrap();
            slot.process = lifecycle.process.take();
            slot.phase = LifecyclePhase::Warm;
            slot.generation = 1;
            slot.has_run = true;
        }
        schedule_idle_shutdown(&state, 1);
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let stopped = {
                let (lock, _) = &*state.shared;
                let value = lock.lock().unwrap();
                value.process.is_none() && value.phase == LifecyclePhase::Unloaded
            };
            if stopped {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "external sidecar did not idle-stop"
            );
            thread::sleep(Duration::from_millis(50));
        }

        let mut restarted = RuntimeLifecycle::default();
        start_verified(&mut restarted, verified_pack_assets(&root).unwrap())
            .expect("restart after idle");
        let second = restarted
            .process
            .as_ref()
            .map(|value| {
                (
                    value.child.id(),
                    value.endpoint.clone(),
                    value.token.clone(),
                )
            })
            .unwrap();
        assert_ne!(first.0, second.0);
        assert_ne!(first.1, second.1);
        assert_ne!(first.2, second.2);
        {
            let process = restarted.process.as_mut().unwrap();
            process.child.kill().unwrap();
            process.child.wait().unwrap();
        }
        ensure_started_assets(&mut restarted, &root).expect("bounded restart after crash");
        assert!(owned_ready(restarted.process.as_ref().unwrap()));
        if let Some(mut process) = restarted.process.take() {
            shutdown_process(&mut process);
            assert!(process.child.try_wait().unwrap().is_some());
        }
    }

    #[test]
    fn external_default_five_minute_idle_measurement() {
        if std::env::var("GREEKGOD_RUN_FIVE_MINUTE_IDLE_MEASUREMENT").as_deref() != Ok("1") {
            return;
        }
        let root = PathBuf::from(
            std::env::var_os("GREEKGOD_MANAGED_RUNTIME_TEST_ROOT").expect("isolated asset root"),
        );
        let mut lifecycle = RuntimeLifecycle::default();
        start_verified(&mut lifecycle, verified_pack_assets(&root).unwrap())
            .expect("measurement start");
        let pid = lifecycle.process.as_ref().unwrap().child.id();
        println!("MEASURE_WARM_PID={pid}");
        let state = ManagedRuntimeState::default();
        {
            let (lock, _) = &*state.shared;
            let mut slot = lock.lock().unwrap();
            slot.process = lifecycle.process.take();
            slot.phase = LifecyclePhase::Warm;
            slot.generation = 1;
            slot.has_run = true;
        }
        schedule_idle_shutdown(&state, 1);
        let deadline = Instant::now() + Duration::from_secs(315);
        loop {
            let stopped = {
                let (lock, _) = &*state.shared;
                let value = lock.lock().unwrap();
                value.process.is_none() && value.phase == LifecyclePhase::Unloaded
            };
            if stopped {
                println!("MEASURE_IDLE_STOPPED_PID={pid}");
                break;
            }
            assert!(
                Instant::now() < deadline,
                "default five-minute idle shutdown did not complete"
            );
            thread::sleep(Duration::from_millis(250));
        }
    }

    fn verified_pack_assets(root: &std::path::Path) -> Result<AssetPaths, String> {
        let pack =
            offline_ai_pack::verify_pack(root, &offline_ai_pack::expected_contract(), &|_| {})
                .map_err(|error| error.to_string())?;
        Ok(AssetPaths {
            root: pack.root,
            runtime: pack.runtime,
            model: pack.model,
        })
    }

    fn ensure_started_assets(
        lifecycle: &mut RuntimeLifecycle,
        root: &std::path::Path,
    ) -> Result<(), String> {
        if let Some(process) = lifecycle.process.as_mut() {
            if process
                .child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
                && owned_ready(process)
            {
                return Ok(());
            }
            shutdown_process(process);
            lifecycle.process = None;
        }
        start_verified(lifecycle, verified_pack_assets(root)?)
    }

    fn test_process() -> ManagedProcess {
        #[cfg(windows)]
        let child = Command::new("cmd")
            .args(["/c", "exit", "0"])
            .spawn()
            .unwrap();
        #[cfg(not(windows))]
        let child = Command::new("true").spawn().unwrap();
        ManagedProcess {
            child,
            endpoint: "http://127.0.0.1:1".into(),
            token: "test".into(),
        }
    }
}
