use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, net::TcpListener, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::{Arc, Mutex}, thread, time::{Duration, Instant}};
use tauri::{AppHandle, Manager};

const RUNTIME_VERSION: &str = "llama.cpp-b7081-80deff3648b93727422461c41c7279ef1dac7452";
const MODEL_SHA256: &str = "b5374915da534cb93df39f03bd4f2cd5a0c533df0d5e21957dc9556c260be9eb";
const RUNTIME_FILES: &[(&str, &str)] = &[
    ("ggml-base.dll", "5a6fea6cac4e2c8b4bee1a3a2794eb155df735b8b6b6e9335c58d580685876b5"),
    ("ggml-cpu-alderlake.dll", "4ee3e8989d3a55feda6f2e40aeac63ea72ca57fca88959ed000151bf834b6e86"),
    ("ggml-cpu-haswell.dll", "52df4fd91959512af8306ee8f68e3f541d922fe0de7f47a63631dbc8e07117bf"),
    ("ggml-cpu-icelake.dll", "622274167f83032e2c7d9e1a8e3eafc5691f58e58afff958b98ded18c3ff314d"),
    ("ggml-cpu-sandybridge.dll", "2bd7facdbd2d942d48817084ab1f4f9bc05835e807d9a1533876693b606138b4"),
    ("ggml-cpu-sapphirerapids.dll", "e1d43a2953f32cb5964ab7ba4aafe28ffb5e0cfb576cca5e1515b28140fb1a01"),
    ("ggml-cpu-skylakex.dll", "86cff1690467a9ee5dadc47abf1ae8bf89e2fd70e9caa019d9eee87ae69934d6"),
    ("ggml-cpu-sse42.dll", "291656099c0de4e7b0ef227d321c6f2d2dbd340807ff3bcb0598e606c6105305"),
    ("ggml-cpu-x64.dll", "22f72dd3e02617f38c771b4ecff18b5b000058b06a695447170bc809e80e710c"),
    ("ggml-rpc.dll", "15ddfdf6b712635f1261f7aae599faf703b0bb7df27c7e4fc644beb17e558e05"),
    ("ggml-vulkan.dll", "e7f88ecba3042fbbb39b223062e158ecca5f5dbdc73786feff8b5b414f037255"),
    ("ggml.dll", "528bfab8fe9636f33341b9ab4fb686d31fe76bc3130909151c6c537c4a803e08"),
    ("libcurl-x64.dll", "5bd5fda8cf2bef630dd4eed5e60b65af2aed9c76c1818c36133701c09cf6d0ac"),
    ("libomp140.x86_64.dll", "9ab1cb787e52b2a36133899c01c1db1f876067d1471cd224ead85f40a8152b99"),
    ("LICENSE-curl", "55f407e7e7100c3188c8988374f472e0a7c0ecaf7ee3ff4796ea391274cc346d"),
    ("LICENSE-httplib", "d5eab7ee2adb2247b367450741f932c6820a883a45ea682a4e2588a8d28b88e9"),
    ("LICENSE-jsonhpp", "61e08da79c44061654015ce6b0c4061c23ee1dd18237fbf09e9bfda3c0ea2831"),
    ("LICENSE-linenoise", "6d7830bc0b53fa551168ef13b12e27073f451edd751d4b4b2ff03442cfe77378"),
    ("llama-batched-bench.exe", "197da3cfacd5cc49e4ede7e655e8228dc1fc2a336c99a425dfbd311657eb14ff"),
    ("llama-bench.exe", "4b4b1960fbe1838d9dd61421a931649e03e5d8856a7f5009d1b0c5fc6a66afe8"),
    ("llama-cli.exe", "f1fa4ec718ab68bfba227001db36f93dbfc5210a25d1804593dbc12e919e256c"),
    ("llama-gemma3-cli.exe", "1e13fbc0398902c22ea1c88452df667832321caeb08de2efff7a1b176123d376"),
    ("llama-gguf-split.exe", "82c009aa95bb892c9d0d9ca9869e6ef6db32cdb0410a6e1b0f0ee05dd832bb78"),
    ("llama-imatrix.exe", "64206408077e8bbaaba948de58a71b5eb296f409b0d8f035dc97856c134ff666"),
    ("llama-llava-cli.exe", "1e13fbc0398902c22ea1c88452df667832321caeb08de2efff7a1b176123d376"),
    ("llama-minicpmv-cli.exe", "1e13fbc0398902c22ea1c88452df667832321caeb08de2efff7a1b176123d376"),
    ("llama-mtmd-cli.exe", "f77135794f340934ec241245f79fbc43c53511599ec34ca68df93fb93858b99d"),
    ("llama-perplexity.exe", "91de5a6203dee3ac3d55c57b76420c5f8fe0ac315632fde0432951f018b61b87"),
    ("llama-quantize.exe", "68706a17673b4b128999d0ac6abf30048f57ea8b1315bd2131a4ce70813f1f62"),
    ("llama-qwen2vl-cli.exe", "1e13fbc0398902c22ea1c88452df667832321caeb08de2efff7a1b176123d376"),
    ("llama-run.exe", "40ee410a46bb20b7d9b9e64c1c8a7cfd4b138c7c9608bfc291ab891a0ef2b7f6"),
    ("llama-server.exe", "190847eff6c0e3b1897ffd1ff0a6038de41f37ee9dd60e1884857e5f74b8c5f1"),
    ("llama-tokenize.exe", "e49bd97703f32a60bc243074427c146d8cf73a32696c7cced5a6d0b4b530a978"),
    ("llama-tts.exe", "d440a5d7d823cf48821e45a2c9cc8c9dfac28ce6fb53561bc11858b44e635859"),
    ("llama.dll", "4ca9a291a9d51231c0760f0df8790b6a38facb7ff1c466382185e5216f7751d7"),
    ("mtmd.dll", "12b5f6c6268d366902b7426eca3e353f755f845abeb28e31bf4595bf4f3d9151"),
    ("rpc-server.exe", "06bf3b8905f0efeddf1d3936d9d01f88b7a1067cb942e3b32e86c86084a5b27b"),
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
    Ok((root.join("runtime").join("llama.cpp-b7081"), root.join("models").join("Phi-3.5-mini-instruct-Q4_0.gguf")))
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
        .args(["--n-gpu-layers", "99", "--ctx-size", "4096", "--parallel", "1", "--no-webui", "--log-disable", "--chat-template", "chatml"])
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
    if request_data.prompt_version != "greekgod-companion-v1" || request_data.system.len() > 20_000 || request_data.input.len() > 100_000 || !request_data.json_schema.is_object() { return Err("invalid bounded inference request".into()); }
    let shared = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = shared.lock().map_err(|_| "managed runtime lock poisoned".to_string())?;
        ensure_started(&app, &mut slot)?;
        let process = slot.as_mut().ok_or_else(|| "managed runtime unavailable".to_string())?;
        let body = json!({"model":"greekgod-phi3.5","temperature":0,"max_tokens":512,"messages":[{"role":"system","content":format!("[{}] {}",request_data.prompt_version,request_data.system)},{"role":"user","content":request_data.input}],"response_format":{"type":"json_schema","json_schema":{"name":"greekgod_response","strict":true,"schema":request_data.json_schema}}});
        let response = request(&process.endpoint, &process.token, "/v1/chat/completions", Some(body))?;
        response.pointer("/choices/0/message/content").and_then(Value::as_str).map(str::to_owned).ok_or_else(|| "incomplete managed sidecar response".into())
    }).await.map_err(|error| format!("managed runtime task failed: {error}"))?
}

pub fn shutdown(state: &ManagedRuntimeState) { if let Ok(mut slot) = state.0.lock() { if let Some(mut process) = slot.take() { shutdown_process(&mut process); } } }
