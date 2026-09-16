use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, net::TcpListener, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::{Arc, Mutex}, thread, time::{Duration, Instant}};
use tauri::{AppHandle, Manager};

const RUNTIME_VERSION: &str = "llama.cpp-b10760-0f3a71be15af836d277c9f918adfafb45732677e";
const MODEL_SHA256: &str = "b5374915da534cb93df39f03bd4f2cd5a0c533df0d5e21957dc9556c260be9eb";
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

#[derive(Default)]
pub struct ManagedRuntimeState(Arc<Mutex<Option<ManagedProcess>>>);
struct ManagedProcess { child: Child, endpoint: String, token: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedStatus { state: &'static str, runtime_version: &'static str, detail: String, endpoint: Option<String> }

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
fn paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let root = root(app)?;
    Ok((root.join("runtime").join("llama.cpp-b10760"), root.join("models").join("Phi-3.5-mini-instruct-Q4_0.gguf")))
}
fn verify(app: &AppHandle) -> Result<(PathBuf, PathBuf), ManagedStatus> {
    let (runtime, model) = paths(app).map_err(|detail| status("FAILED", detail, None))?;
    let count = std::fs::read_dir(&runtime).map_err(|_| status("RUNTIME_MISSING", "Runtime directory is missing".into(), None))?
        .filter_map(Result::ok).filter(|entry| entry.path().is_file()).count();
    if count != RUNTIME_FILES.len() { return Err(status("RUNTIME_INCOMPATIBLE", "Runtime inventory contains missing or extra files".into(), None)); }
    for (name, expected) in RUNTIME_FILES {
        let path = runtime.join(name);
        if !path.is_file() { return Err(status("RUNTIME_MISSING", format!("Missing {name}"), None)); }
        if hash(&path).as_deref() != Ok(*expected) { return Err(status("RUNTIME_INCOMPATIBLE", format!("Checksum mismatch: {name}"), None)); }
    }
    if !model.is_file() { return Err(status("MODEL_MISSING", "Model file is not installed".into(), None)); }
    if hash(&model).as_deref() != Ok(MODEL_SHA256) { return Err(status("MODEL_CHECKSUM_MISMATCH", "Model checksum mismatch".into(), None)); }
    Ok((runtime, model))
}
fn status(state: &'static str, detail: String, endpoint: Option<String>) -> ManagedStatus { ManagedStatus { state, runtime_version: RUNTIME_VERSION, detail, endpoint } }
fn token() -> Result<String, String> { let mut bytes = [0_u8; 32]; getrandom::fill(&mut bytes).map_err(|error| error.to_string())?; Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect()) }
fn request(endpoint: &str, token: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    let url = format!("{endpoint}{path}");
    let agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(30))).build().new_agent();
    let response = if let Some(value) = body { agent.post(&url).header("Authorization", &format!("Bearer {token}")).send_json(value) }
        else { agent.get(&url).header("Authorization", &format!("Bearer {token}")).call() }.map_err(|error| format!("managed sidecar request failed: {error}"))?;
    response.into_body().read_json::<Value>().map_err(|error| format!("invalid sidecar response: {error}"))
}
fn owned_ready(process: &ManagedProcess) -> bool {
    request(&process.endpoint, &process.token, "/v1/models", None).is_ok()
        && request(&process.endpoint, "invalid-greekgod-instance-token", "/v1/models", None).is_err()
        && request(&process.endpoint, &process.token, "/health", None).ok().and_then(|value| value.get("status").and_then(Value::as_str).map(str::to_owned)).as_deref() == Some("ok")
}
fn shutdown_process(process: &mut ManagedProcess) {
    let _ = request(&process.endpoint, &process.token, "/shutdown", Some(json!({})));
    let until = Instant::now() + Duration::from_secs(2);
    while Instant::now() < until { if matches!(process.child.try_wait(), Ok(Some(_))) { return; } thread::sleep(Duration::from_millis(50)); }
    let _ = process.child.kill(); let _ = process.child.wait();
}
fn ensure_started(app: &AppHandle, slot: &mut Option<ManagedProcess>) -> Result<(), String> {
    if let Some(process) = slot.as_mut() {
        if process.child.try_wait().map_err(|error| error.to_string())?.is_none()
            && owned_ready(process) { return Ok(()); }
        shutdown_process(process); *slot = None;
    }
    let (runtime, model) = verify(app).map_err(|value| value.detail)?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port(); drop(listener);
    let secret = token()?; let endpoint = format!("http://127.0.0.1:{port}");
    let mut command = Command::new(runtime.join("llama-server.exe"));
    command.current_dir(&runtime).args(["--host", "127.0.0.1", "--port", &port.to_string(), "--model"]).arg(&model)
        .args(["--n-gpu-layers", "99", "--ctx-size", "4096", "--parallel", "1", "--no-webui", "--log-disable"])
        .env("LLAMA_ARG_API_KEY", &secret).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let child = command.spawn().map_err(|error| format!("managed sidecar start failed: {error}"))?;
    let mut process = ManagedProcess { child, endpoint, token: secret };
    let until = Instant::now() + Duration::from_secs(25);
    while Instant::now() < until {
        if process.child.try_wait().map_err(|error| error.to_string())?.is_some() { return Err("managed sidecar exited during startup".into()); }
        if owned_ready(&process) { *slot = Some(process); return Ok(()); }
        thread::sleep(Duration::from_millis(100));
    }
    shutdown_process(&mut process); Err("managed sidecar startup timed out".into())
}

#[tauri::command]
pub async fn managed_companion_status(app: AppHandle, state: tauri::State<'_, ManagedRuntimeState>) -> Result<ManagedStatus, String> {
    let shared = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = shared.lock().map_err(|_| "managed runtime lock poisoned".to_string())?;
        if let Some(process) = slot.as_mut() {
            if process.child.try_wait().map_err(|error| error.to_string())?.is_none() && owned_ready(process) {
                return Ok(status("READY", "GreekGod managed runtime is ready".into(), Some(process.endpoint.clone())));
            }
            shutdown_process(process); *slot = None;
            return Ok(status("FAILED", "Managed sidecar exited or became unhealthy".into(), None));
        }
        Ok(match verify(&app) { Ok(_) => status("STARTING", "Verified assets; runtime starts on first inference".into(), None), Err(value) => value })
    }).await.map_err(|error| format!("managed runtime task failed: {error}"))?
}

#[tauri::command]
pub async fn managed_companion_infer(app: AppHandle, state: tauri::State<'_, ManagedRuntimeState>, request_data: ManagedInferenceRequest) -> Result<String, String> {
    let supported_contract = matches!(request_data.prompt_version.as_str(), "greekgod-trainer-v2" | "greekgod-dialogue-v2" | "greekgod-memory-v2" | "greekgod-command-v2");
    if !supported_contract || request_data.system.len() > 20_000 || request_data.input.len() > 100_000 || !request_data.json_schema.is_object() { return Err("invalid bounded inference request".into()); }
    let shared = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = shared.lock().map_err(|_| "managed runtime lock poisoned".to_string())?;
        ensure_started(&app, &mut slot)?;
        let process = slot.as_mut().ok_or_else(|| "managed runtime unavailable".to_string())?;
        let prompt = format!("<|system|>\n[greekgod-companion-v1] [{}] {}<|end|>\n<|user|>\n{}<|end|>\n<|assistant|>\n", request_data.prompt_version, request_data.system, request_data.input);
        let body = json!({"prompt":prompt,"n_predict":512,"temperature":0,"seed":42,"top_k":40,"top_p":0.9,"min_p":0.1,"repeat_last_n":64,"repeat_penalty":1,"presence_penalty":0,"frequency_penalty":0,"stop":["<|system|>","<|user|>","<|end|>","<|assistant|>"],"json_schema":request_data.json_schema});
        let response = request(&process.endpoint, &process.token, "/completion", Some(body))?;
        response.get("content").and_then(Value::as_str).map(str::to_owned).ok_or_else(|| "incomplete managed sidecar response".into())
    }).await.map_err(|error| format!("managed runtime task failed: {error}"))?
}

pub fn shutdown(state: &ManagedRuntimeState) { if let Ok(mut slot) = state.0.lock() { if let Some(mut process) = slot.take() { shutdown_process(&mut process); } } }
