use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, net::TcpListener, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::{Arc, Condvar, Mutex}, thread, time::{Duration, Instant}};
use tauri::{AppHandle, Manager};

const RUNTIME_VERSION: &str = "llama.cpp-b10760-0f3a71be15af836d277c9f918adfafb45732677e";
const MODEL_SHA256: &str = "b5374915da534cb93df39f03bd4f2cd5a0c533df0d5e21957dc9556c260be9eb";
const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const RUNTIME_FILES: &[(&str, &str)] = &[
    ("ggml-base.dll", "90019653b09ba00db880004c7416d4351e54f70d47a0f605bec1d5df8a7fb8c8"),
    ("ggml-cpu-alderlake.dll", "2af74a6602a8d38844afcbb99763948fcd619cd02631c3ed10790b48e0f9db4e"),
    ("ggml-cpu-cannonlake.dll", "fd77af00d34b50c3884a15e4beb5672c433ae29b18951b9e36857179a4689bd4"),
    ("ggml-cpu-cascadelake.dll", "ee3a00bb925efdb1ca640a0e1c7bf6492fcb12767d8650f89d2afa565ba92af6"),
    ("ggml-cpu-cooperlake.dll", "8efe676c118e854d43836f1141638114cb6f668dad098384dcbfaf8bb1ccec15"),
    ("ggml-cpu-haswell.dll", "8e3bbf8d0aced02762d6a2280fe74c0f29f9d373161b3244b71c43632b8537da"),
    ("ggml-cpu-icelake.dll", "ec91e456d2c595a442bead5ad42dea076d4badd64572dbc444d501165a409746"),
    ("ggml-cpu-ivybridge.dll", "085a820be42eac511108a9935c058bbf2b4c943814e38378d90481b45d74248b"),
    ("ggml-cpu-piledriver.dll", "d740a0a7c261ba443ae7905f71b2791be1bc3b228e90b058ede9f7c1615cb93a"),
    ("ggml-cpu-sandybridge.dll", "4a2d34cc0506b2f71366de5ad8c8f4a14d7990f62aa6b10792861ba0475878bf"),
    ("ggml-cpu-sapphirerapids.dll", "c7461fc8b85fe4e081d875cb653cb821b49dd1a3ff46806557c97af6d686024f"),
    ("ggml-cpu-skylakex.dll", "6afca980f1b1bcc7c0e096dcce54d83c8705afb02d44a16b46b9af85a59d645f"),
    ("ggml-cpu-sse42.dll", "0f76727fec2dcf5259d708cb583ae6bf9cc7a8b21e8c0f93fbfd1c5ccc16291c"),
    ("ggml-cpu-x64.dll", "fd24bebb1f3403bd631295d74b7330414fbd3545b52a890c07c330b998170a49"),
    ("ggml-cpu-zen4.dll", "3a64862960db433186edc40b806e1e82e5b39b4af91a8cf3ff64685b1b42896b"),
    ("ggml-vulkan.dll", "3d7141d851ed7c8a31693c1413696bae536a8f40add24fd79fa2612fc144790c"),
    ("ggml.dll", "ca63f33a59b8dff8ea66bbec024eca31ae86f43685f80b65c48f1a120795876b"),
    ("libomp.dll", "a12116ba72d1d6820407cf30be23da04ce79d6bb8a71a5ee71759c5a1faa6f1c"),
    ("LICENSE-LLVM-OpenMP", "fdad1758a9e1f9d5a81e18879b3406772115edc92c24bfa36b70c654f325e8e4"),
    ("llama-common.dll", "c3e30505b5e4b3e986251aad01d72c1f2c8e83681f12b261f4458ba4e24d6b5a"),
    ("llama-server-impl.dll", "1ba1fd9c009101036b682ea83967dc42e6c2d5863fc88b368479f311679740be"),
    ("llama-server.exe", "4d2f56c46859a3679fbfa35cc0fbad405ac239a7a35f64e9f2ff613407be0963"),
    ("llama.dll", "f5afd819fb0e8632228740f1aa5fde3ff165794eaca07ca2ee71a9fffdf9e6b1"),
    ("mtmd.dll", "70045cfa7ce5dc68a938fc76736c4156be5117d655bc3c74f8bc65a5a8482db0"),
];

pub struct ManagedRuntimeState {
    shared: Arc<(Mutex<RuntimeLifecycle>, Condvar)>,
    idle_timeout: Duration,
}
impl Default for ManagedRuntimeState {
    fn default() -> Self { Self::with_idle_timeout(DEFAULT_IDLE_TIMEOUT) }
}
impl ManagedRuntimeState {
    fn with_idle_timeout(idle_timeout: Duration) -> Self {
        Self { shared: Arc::new((Mutex::new(RuntimeLifecycle::default()), Condvar::new())), idle_timeout }
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
enum LifecyclePhase { #[default] Unloaded, Starting, Warm, Active, Stopping, Failed }
struct ManagedProcess { child: Child, endpoint: String, token: String }

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
pub struct ManagedInferenceRequest { prompt_version: String, system: String, input: String, json_schema: Value }

fn hash(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "required asset is missing".to_string())?;
    let mut digest = Sha256::new(); let mut buffer = [0_u8; 1024 * 1024];
    loop { let count = file.read(&mut buffer).map_err(|_| "asset could not be read".to_string())?; if count == 0 { break; } digest.update(&buffer[..count]); }
    Ok(format!("{:x}", digest.finalize()))
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let production = app.config().identifier == "com.igorpich.formlog";
    if !production { if let Some(value) = std::env::var_os("GREEKGOD_MANAGED_RUNTIME_ROOT") { return Ok(PathBuf::from(value)); } }
    app.path().app_local_data_dir().map(|path| path.join("companion-managed-runtime")).map_err(|error| error.to_string())
}
#[derive(Debug)]
struct AssetPaths { root: PathBuf, runtime: PathBuf, model: PathBuf }
fn asset_paths(root: PathBuf) -> AssetPaths {
    AssetPaths { runtime: root.join("runtime").join("llama.cpp-b10760"), model: root.join("models").join("Phi-3.5-mini-instruct-Q4_0.gguf"), root }
}
fn paths(app: &AppHandle) -> Result<AssetPaths, String> {
    Ok(asset_paths(root(app)?))
}
fn verify_assets(paths: AssetPaths) -> Result<AssetPaths, ManagedStatus> {
    let asset_root = Some(paths.root.display().to_string());
    let count = std::fs::read_dir(&paths.runtime).map_err(|_| status("RUNTIME_MISSING", "Runtime directory is missing".into(), None, asset_root.clone()))?
        .filter_map(Result::ok).filter(|entry| entry.path().is_file()).count();
    if count != RUNTIME_FILES.len() { return Err(status("RUNTIME_INVALID", "Runtime inventory contains missing or extra files".into(), None, asset_root)); }
    for (name, expected) in RUNTIME_FILES {
        let path = paths.runtime.join(name);
        if !path.is_file() { return Err(status("RUNTIME_INVALID", format!("Missing runtime component: {name}"), None, Some(paths.root.display().to_string()))); }
        if hash(&path).as_deref() != Ok(*expected) { return Err(status("RUNTIME_INVALID", format!("Runtime checksum mismatch: {name}"), None, Some(paths.root.display().to_string()))); }
    }
    if !paths.model.is_file() { return Err(status("MODEL_MISSING", "Model file is not installed".into(), None, Some(paths.root.display().to_string()))); }
    if hash(&paths.model).as_deref() != Ok(MODEL_SHA256) { return Err(status("MODEL_INVALID", "Model checksum mismatch".into(), None, Some(paths.root.display().to_string()))); }
    Ok(paths)
}
fn verify(app: &AppHandle) -> Result<AssetPaths, ManagedStatus> {
    verify_assets(paths(app).map_err(|detail| status("FAILED", detail, None, None))?)
}
fn status(state: &'static str, detail: String, endpoint: Option<String>, asset_root: Option<String>) -> ManagedStatus {
    ManagedStatus { state, runtime_version: RUNTIME_VERSION, detail, endpoint, asset_root, installation: "MANUAL_ONLY" }
}
fn token() -> Result<String, String> { let mut bytes = [0_u8; 32]; getrandom::fill(&mut bytes).map_err(|error| error.to_string())?; Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect()) }
fn request(endpoint: &str, token: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    request_with_timeout(endpoint, token, path, body, Duration::from_secs(30))
}
fn request_with_timeout(endpoint: &str, token: &str, path: &str, body: Option<Value>, timeout: Duration) -> Result<Value, String> {
    let url = format!("{endpoint}{path}");
    let agent = ureq::Agent::config_builder().timeout_global(Some(timeout)).build().new_agent();
    let response = if let Some(value) = body { agent.post(&url).header("Authorization", &format!("Bearer {token}")).send_json(value) }
        else { agent.get(&url).header("Authorization", &format!("Bearer {token}")).call() }.map_err(|error| format!("managed sidecar request failed: {error}"))?;
    response.into_body().read_json::<Value>().map_err(|error| format!("invalid sidecar response: {error}"))
}
fn owned_ready(process: &ManagedProcess) -> bool {
    let timeout = Duration::from_millis(500);
    request_with_timeout(&process.endpoint, &process.token, "/v1/models", None, timeout).is_ok()
        && request_with_timeout(&process.endpoint, "invalid-greekgod-instance-token", "/v1/models", None, timeout).is_err()
        && request_with_timeout(&process.endpoint, &process.token, "/health", None, timeout).ok().and_then(|value| value.get("status").and_then(Value::as_str).map(str::to_owned)).as_deref() == Some("ok")
}
fn shutdown_process(process: &mut ManagedProcess) {
    let _ = request_with_timeout(&process.endpoint, &process.token, "/shutdown", Some(json!({})), Duration::from_secs(2));
    let until = Instant::now() + Duration::from_secs(2);
    while Instant::now() < until { if matches!(process.child.try_wait(), Ok(Some(_))) { return; } thread::sleep(Duration::from_millis(50)); }
    let _ = process.child.kill(); let _ = process.child.wait();
}
fn ensure_started(app: &AppHandle, lifecycle: &mut RuntimeLifecycle) -> Result<(), String> {
    if let Some(process) = lifecycle.process.as_mut() {
        if process.child.try_wait().map_err(|error| error.to_string())?.is_none()
            && owned_ready(process) { return Ok(()); }
        shutdown_process(process); lifecycle.process = None;
    }
    let assets = verify(app).map_err(|value| value.detail)?;
    start_verified(lifecycle, assets)
}
fn start_verified(lifecycle: &mut RuntimeLifecycle, assets: AssetPaths) -> Result<(), String> {
    lifecycle.phase = LifecyclePhase::Starting;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port(); drop(listener);
    let secret = token()?; let endpoint = format!("http://127.0.0.1:{port}");
    let mut command = Command::new(assets.runtime.join("llama-server.exe"));
    command.current_dir(&assets.runtime).args(["--host", "127.0.0.1", "--port", &port.to_string(), "--model"]).arg(&assets.model)
        .args(["--n-gpu-layers", "99", "--ctx-size", "4096", "--parallel", "1", "--no-webui", "--offline", "--cors-origins", "localhost", "--log-disable"])
        .env("LLAMA_API_KEY", &secret).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let child = command.spawn().map_err(|error| format!("managed sidecar start failed: {error}"))?;
    let mut process = ManagedProcess { child, endpoint, token: secret };
    let until = Instant::now() + Duration::from_secs(25);
    while Instant::now() < until {
        if process.child.try_wait().map_err(|error| error.to_string())?.is_some() { return Err("managed sidecar exited during startup".into()); }
        if owned_ready(&process) { lifecycle.process = Some(process); lifecycle.has_run = true; lifecycle.phase = LifecyclePhase::Warm; return Ok(()); }
        thread::sleep(Duration::from_millis(100));
    }
    shutdown_process(&mut process); Err("managed sidecar startup timed out".into())
}

fn schedule_idle_shutdown(state: &ManagedRuntimeState, generation: u64) {
    let shared = Arc::clone(&state.shared); let timeout = state.idle_timeout;
    thread::spawn(move || {
        thread::sleep(timeout);
        let (lock, wake) = &*shared;
        let mut lifecycle = match lock.lock() { Ok(value) => value, Err(_) => return };
        if !idle_shutdown_eligible(&lifecycle, generation) { return; }
        lifecycle.phase = LifecyclePhase::Stopping;
        let mut process = lifecycle.process.take();
        drop(lifecycle);
        if let Some(process) = process.as_mut() { shutdown_process(process); }
        let mut lifecycle = match lock.lock() { Ok(value) => value, Err(_) => return };
        if !lifecycle.shutting_down { lifecycle.phase = LifecyclePhase::Unloaded; }
        wake.notify_all();
    });
}

fn idle_shutdown_eligible(lifecycle: &RuntimeLifecycle, generation: u64) -> bool {
    !lifecycle.shutting_down && lifecycle.generation == generation && !lifecycle.active
        && lifecycle.queued == 0 && lifecycle.process.is_some()
}

fn lifecycle_status(app: &AppHandle, lifecycle: &mut RuntimeLifecycle) -> ManagedStatus {
    let asset_root = paths(app).ok().map(|value| value.root.display().to_string());
    if lifecycle.shutting_down { return status("STOPPING", "Managed runtime is stopping".into(), None, asset_root); }
    if lifecycle.active { return status("INFERENCE_ACTIVE", "Local inference is active".into(), lifecycle.process.as_ref().map(|value| value.endpoint.clone()), asset_root); }
    match lifecycle.phase {
        LifecyclePhase::Starting => return status("STARTING", "Local model is starting and loading".into(), None, asset_root),
        LifecyclePhase::Stopping => return status("STOPPING", "Idle managed runtime is stopping".into(), None, asset_root),
        LifecyclePhase::Failed => return status("FAILED", lifecycle.last_failure.clone().unwrap_or_else(|| "Managed runtime failed safely".into()), None, asset_root),
        LifecyclePhase::Warm => {
            if let Some(process) = lifecycle.process.as_mut() {
                if process.child.try_wait().ok().flatten().is_none() && owned_ready(process) {
                    return status("READY_WARM", "Local model is loaded and ready".into(), Some(process.endpoint.clone()), asset_root);
                }
                shutdown_process(process); lifecycle.process = None; lifecycle.phase = LifecyclePhase::Failed;
                lifecycle.last_failure = Some("Managed sidecar exited or became unhealthy".into());
                return status("FAILED", lifecycle.last_failure.clone().unwrap(), None, asset_root);
            }
        }
        LifecyclePhase::Unloaded | LifecyclePhase::Active => {}
    }
    match verify(app) {
        Ok(paths) => status(if lifecycle.has_run { "IDLE_UNLOADED" } else { "READY_UNLOADED" },
            if lifecycle.has_run { "Local model was unloaded after inactivity".into() } else { "Verified assets; model loads on first AI request".into() },
            None, Some(paths.root.display().to_string())),
        Err(value) => value,
    }
}

#[tauri::command]
pub async fn managed_companion_status(app: AppHandle, state: tauri::State<'_, ManagedRuntimeState>) -> Result<ManagedStatus, String> {
    let shared = Arc::clone(&state.shared);
    tauri::async_runtime::spawn_blocking(move || {
        let (lock, _) = &*shared;
        let mut lifecycle = lock.lock().map_err(|_| "managed runtime lock poisoned".to_string())?;
        Ok(lifecycle_status(&app, &mut lifecycle))
    }).await.map_err(|error| format!("managed runtime task failed: {error}"))?
}

#[tauri::command]
pub async fn managed_companion_infer(app: AppHandle, state: tauri::State<'_, ManagedRuntimeState>, request_data: ManagedInferenceRequest) -> Result<String, String> {
    let supported_contract = matches!(request_data.prompt_version.as_str(), "greekgod-trainer-v2" | "greekgod-dialogue-v2" | "greekgod-memory-v2" | "greekgod-command-v2");
    if !supported_contract || request_data.system.len() > 20_000 || request_data.input.len() > 100_000 || !request_data.json_schema.is_object() { return Err("invalid bounded inference request".into()); }
    let shared = Arc::clone(&state.shared); let idle_timeout = state.idle_timeout;
    {
        let (lock, _) = &*shared;
        let mut lifecycle = lock.lock().map_err(|_| "managed runtime lock poisoned".to_string())?;
        if lifecycle.shutting_down { return Err("managed runtime is shutting down".into()); }
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
    let timer_state = ManagedRuntimeState { shared: Arc::clone(&state.shared), idle_timeout };
    schedule_idle_shutdown(&timer_state, result.1);
    result.0
}

pub fn shutdown(state: &ManagedRuntimeState) {
    let (lock, wake) = &*state.shared;
    let mut lifecycle = match lock.lock() { Ok(value) => value, Err(_) => return };
    lifecycle.shutting_down = true; lifecycle.generation = lifecycle.generation.wrapping_add(1); lifecycle.phase = LifecyclePhase::Stopping;
    let mut process = lifecycle.process.take(); drop(lifecycle);
    if let Some(process) = process.as_mut() { shutdown_process(process); }
    if let Ok(mut lifecycle) = lock.lock() { lifecycle.active = false; lifecycle.phase = LifecyclePhase::Unloaded; wake.notify_all(); }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_policy_is_five_minutes_and_startup_is_unloaded() {
        let state = ManagedRuntimeState::default();
        assert_eq!(state.idle_timeout, Duration::from_secs(300));
        let (lock, _) = &*state.shared; let lifecycle = lock.lock().unwrap();
        assert!(lifecycle.process.is_none()); assert_eq!(lifecycle.phase, LifecyclePhase::Unloaded);
        assert!(!lifecycle.active); assert_eq!(lifecycle.queued, 0);
    }

    #[test]
    fn active_queued_stale_and_shutdown_states_cannot_idle_stop() {
        let mut lifecycle = RuntimeLifecycle::default();
        lifecycle.process = Some(test_process()); lifecycle.generation = 7;
        lifecycle.active = true; assert!(!idle_shutdown_eligible(&lifecycle, 7));
        lifecycle.active = false; lifecycle.queued = 1; assert!(!idle_shutdown_eligible(&lifecycle, 7));
        lifecycle.queued = 0; assert!(!idle_shutdown_eligible(&lifecycle, 6));
        lifecycle.shutting_down = true; assert!(!idle_shutdown_eligible(&lifecycle, 7));
        lifecycle.shutting_down = false; assert!(idle_shutdown_eligible(&lifecycle, 7));
        if let Some(mut process) = lifecycle.process.take() { let _ = process.child.wait(); }
    }

    #[test]
    fn configured_idle_timer_stops_owned_process_and_marks_unloaded() {
        let state = ManagedRuntimeState::with_idle_timeout(Duration::from_millis(20));
        let (lock, _) = &*state.shared;
        { let mut lifecycle = lock.lock().unwrap(); lifecycle.process = Some(test_process()); lifecycle.phase = LifecyclePhase::Warm; lifecycle.generation = 3; }
        schedule_idle_shutdown(&state, 3);
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            { let lifecycle = lock.lock().unwrap(); if lifecycle.phase == LifecyclePhase::Unloaded { assert!(lifecycle.process.is_none()); break; } }
            assert!(Instant::now() < deadline, "idle shutdown did not complete"); thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn external_pinned_runtime_start_reuse_idle_restart_crash_and_asset_failures() {
        let Some(root) = std::env::var_os("GREEKGOD_MANAGED_RUNTIME_TEST_ROOT").map(PathBuf::from) else { return };
        let assets = verify_assets(asset_paths(root.clone())).expect("isolated pinned assets must verify");
        let mut lifecycle = RuntimeLifecycle::default();
        start_verified(&mut lifecycle, assets).expect("first start");
        let first = lifecycle.process.as_ref().map(|value| (value.child.id(), value.endpoint.clone(), value.token.clone())).unwrap();
        assert!(owned_ready(lifecycle.process.as_ref().unwrap()));
        ensure_started_assets(&mut lifecycle, asset_paths(root.clone())).expect("ready runtime must be reused");
        assert_eq!(lifecycle.process.as_ref().unwrap().child.id(), first.0, "ready runtime must not spawn a duplicate sidecar");

        let process = lifecycle.process.as_ref().unwrap();
        let fact = "Ostatnie 30 dni: zapisano 3 treningi; 3 ma zapisany czas; łącznie 135 min.";
        let prompt = format!("<|system|>\n[greekgod-companion-v1] [greekgod-dialogue-v2] Jesteś modułem odpowiedzi tylko do odczytu. Odpowiedz krótko po polsku na pytanie, używając wartości z evidence. Zwróć wyłącznie JSON.<|end|>\n<|user|>\n{{\"kind\":\"COMPANION_READ_ONLY\",\"input\":{{\"kind\":\"USER_DIALOGUE\",\"text\":\"Ile treningów wykonałem w ostatnich 30 dniach?\"}},\"evidence\":[{{\"id\":\"evidence-1\",\"text\":\"{fact}\"}}],\"mutationLike\":false}}<|end|>\n<|assistant|>\n");
        let body = json!({"prompt":prompt,"n_predict":512,"temperature":0,"seed":42,"top_k":40,"top_p":0.9,"min_p":0.1,"repeat_last_n":64,"repeat_penalty":1,"presence_penalty":0,"frequency_penalty":0,"stop":["<|system|>","<|user|>","<|end|>","<|assistant|>"],"json_schema":{
            "type":"object","additionalProperties":false,"required":["message","evidenceUses","mutationStatus"],"properties":{
                "message":{"type":"string"},"evidenceUses":{"type":"array","minItems":1,"maxItems":1,"items":{"type":"object","additionalProperties":false,"required":["id","fact"],"properties":{"id":{"const":"evidence-1"},"fact":{"const":fact}}}},"mutationStatus":{"const":"NOT_APPLICABLE"}
            }
        }});
        let value = request(&process.endpoint, &process.token, "/completion", Some(body)).expect("cold synthetic inference must complete");
        let content = value.get("content").and_then(Value::as_str).expect("cold synthetic inference content");
        let parsed: Value = serde_json::from_str(content).expect("cold synthetic inference must return JSON");
        assert_eq!(parsed["evidenceUses"][0]["id"], "evidence-1");
        assert_eq!(parsed["evidenceUses"][0]["fact"], fact);
        assert_eq!(parsed["mutationStatus"], "NOT_APPLICABLE");

        let state = ManagedRuntimeState::with_idle_timeout(Duration::from_millis(100));
        { let (lock, _) = &*state.shared; let mut slot = lock.lock().unwrap(); slot.process = lifecycle.process.take(); slot.phase = LifecyclePhase::Warm; slot.generation = 1; slot.has_run = true; }
        schedule_idle_shutdown(&state, 1);
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let stopped = { let (lock, _) = &*state.shared; let value = lock.lock().unwrap(); value.process.is_none() && value.phase == LifecyclePhase::Unloaded };
            if stopped { break; } assert!(Instant::now() < deadline, "external sidecar did not idle-stop"); thread::sleep(Duration::from_millis(50));
        }

        let mut restarted = RuntimeLifecycle::default();
        start_verified(&mut restarted, verify_assets(asset_paths(root.clone())).unwrap()).expect("restart after idle");
        let second = restarted.process.as_ref().map(|value| (value.child.id(), value.endpoint.clone(), value.token.clone())).unwrap();
        assert_ne!(first.0, second.0); assert_ne!(first.1, second.1); assert_ne!(first.2, second.2);
        { let process = restarted.process.as_mut().unwrap(); process.child.kill().unwrap(); process.child.wait().unwrap(); }
        ensure_started_assets(&mut restarted, asset_paths(root.clone())).expect("bounded restart after crash");
        assert!(owned_ready(restarted.process.as_ref().unwrap()));

        let temp = tempfile::tempdir().unwrap();
        let missing = asset_paths(temp.path().join("missing"));
        assert_eq!(verify_assets(missing).unwrap_err().state, "RUNTIME_MISSING");
        let staged_root = temp.path().join("staged"); let staged = asset_paths(staged_root.clone());
        std::fs::create_dir_all(&staged.runtime).unwrap(); std::fs::create_dir_all(staged.model.parent().unwrap()).unwrap();
        let source = asset_paths(root.clone());
        for (name, _) in RUNTIME_FILES { std::fs::copy(source.runtime.join(name), staged.runtime.join(name)).unwrap(); }
        assert_eq!(verify_assets(asset_paths(staged_root.clone())).unwrap_err().state, "MODEL_MISSING");
        std::fs::write(&staged.model, b"corrupt synthetic model").unwrap();
        assert_eq!(verify_assets(asset_paths(staged_root.clone())).unwrap_err().state, "MODEL_INVALID");
        std::fs::remove_file(staged.runtime.join("ggml.dll")).unwrap();
        assert_eq!(verify_assets(asset_paths(staged_root.clone())).unwrap_err().state, "RUNTIME_INVALID");
        std::fs::write(staged.runtime.join("ggml.dll"), b"corrupt synthetic runtime").unwrap();
        assert_eq!(verify_assets(asset_paths(staged_root)).unwrap_err().state, "RUNTIME_INVALID");
        if let Some(mut process) = restarted.process.take() { shutdown_process(&mut process); assert!(process.child.try_wait().unwrap().is_some()); }
    }

    #[test]
    fn external_default_five_minute_idle_measurement() {
        if std::env::var("GREEKGOD_RUN_FIVE_MINUTE_IDLE_MEASUREMENT").as_deref() != Ok("1") { return; }
        let root = PathBuf::from(std::env::var_os("GREEKGOD_MANAGED_RUNTIME_TEST_ROOT").expect("isolated asset root"));
        let mut lifecycle = RuntimeLifecycle::default();
        start_verified(&mut lifecycle, verify_assets(asset_paths(root)).unwrap()).expect("measurement start");
        let pid = lifecycle.process.as_ref().unwrap().child.id(); println!("MEASURE_WARM_PID={pid}");
        let state = ManagedRuntimeState::default();
        { let (lock, _) = &*state.shared; let mut slot = lock.lock().unwrap(); slot.process = lifecycle.process.take(); slot.phase = LifecyclePhase::Warm; slot.generation = 1; slot.has_run = true; }
        schedule_idle_shutdown(&state, 1);
        let deadline = Instant::now() + Duration::from_secs(315);
        loop {
            let stopped = { let (lock, _) = &*state.shared; let value = lock.lock().unwrap(); value.process.is_none() && value.phase == LifecyclePhase::Unloaded };
            if stopped { println!("MEASURE_IDLE_STOPPED_PID={pid}"); break; }
            assert!(Instant::now() < deadline, "default five-minute idle shutdown did not complete"); thread::sleep(Duration::from_millis(250));
        }
    }

    fn ensure_started_assets(lifecycle: &mut RuntimeLifecycle, assets: AssetPaths) -> Result<(), String> {
        if let Some(process) = lifecycle.process.as_mut() {
            if process.child.try_wait().map_err(|error| error.to_string())?.is_none() && owned_ready(process) { return Ok(()); }
            shutdown_process(process); lifecycle.process = None;
        }
        start_verified(lifecycle, verify_assets(assets).map_err(|value| value.detail)?)
    }

    fn test_process() -> ManagedProcess {
        #[cfg(windows)]
        let child = Command::new("cmd").args(["/c", "exit", "0"]).spawn().unwrap();
        #[cfg(not(windows))]
        let child = Command::new("true").spawn().unwrap();
        ManagedProcess { child, endpoint: "http://127.0.0.1:1".into(), token: "test".into() }
    }
}
