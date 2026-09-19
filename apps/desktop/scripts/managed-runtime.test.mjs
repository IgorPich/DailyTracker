import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const rust = readFileSync(new URL('../src-tauri/src/managed_companion_runtime.rs', import.meta.url), 'utf8')
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
const model = readFileSync(new URL('../src/services/localCompanionModel.ts', import.meta.url), 'utf8')
const trainer = readFileSync(new URL('../src/services/trainerProposalModel.ts', import.meta.url), 'utf8')
const acquire = readFileSync(new URL('./managed-runtime/acquire-llama-runtime.ps1', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('./managed-runtime/llama-b10760-win-vulkan-x64.manifest.json', import.meta.url), 'utf8'))

assert.match(rust, /TcpListener::bind\("127\.0\.0\.1:0"\)/)
assert.match(rust, /\.env\("LLAMA_API_KEY", &secret\)/)
assert.doesNotMatch(rust, /LLAMA_ARG_API_KEY/)
assert.match(rust, /invalid-greekgod-instance-token/)
assert.doesNotMatch(rust, /0\.0\.0\.0|--api-key["']/)
assert.doesNotMatch(rust, /AppData|SQLite|ActionDefinitionRegistry|TrackingCommandGateway|sync credential/i)
assert.match(lib, /RunEvent::Exit.*RunEvent::ExitRequested/)
assert.match(lib, /managed_companion_runtime::shutdown/)
assert.match(trainer, /managedCompanionModel/)
assert.doesNotMatch(trainer, /=\s*localCompanionModel\b|Ollama/)
assert.match(rust, /"\/completion"/) // pinned b10760 raw completion transport
assert.match(rust, /"json_schema":request_data\.json_schema/) // provider request uses constrained JSON schema
assert.doesNotMatch(rust, /\/v1\/chat\/completions|response_format/)
assert.match(rust, /\[greekgod-companion-v1\]/)
for (const stop of ['<|system|>', '<|user|>', '<|end|>', '<|assistant|>']) assert.match(rust, new RegExp(stop.replaceAll('|', '\\|')))
assert.match(model, /jsonSchema/) // provider-neutral request carries that schema to the runtime
assert.match(rust, /--ctx-size", "4096"/)
for (const setting of ['"seed":42', '"n_predict":512', '"temperature":0', '"top_k":40', '"top_p":0.9', '"min_p":0.1', '"repeat_last_n":64', '"repeat_penalty":1', '"presence_penalty":0', '"frequency_penalty":0']) {
  assert.match(rust, new RegExp(setting.replace('.', '\\.')))
}
assert.doesNotMatch(model, /OllamaDevelopmentRuntime|127\.0\.0\.1:11434|\/api\/chat/)
assert.doesNotMatch(acquire, /Phi|gguf|MODEL_SHA/i) // runtime acquisition never downloads a model
assert.match(acquire, /b10760/)
assert.match(acquire, /34dfb5aab953a1e69faf0fc185edda10ff08e515f5607f7b8cdda740b1ed88cb/)
assert.equal(manifest.release, 'b10760')
assert.equal(manifest.commit, '0f3a71be15af836d277c9f918adfafb45732677e')
assert.equal(manifest.files.length, 24)
for (const file of manifest.files) {
  assert.match(file.sha256, /^[a-f0-9]{64}$/)
  assert.match(rust, new RegExp(`\\("${file.name.replaceAll('.', '\\.')}"\\s*,\\s*"${file.sha256}"\\)`))
}
assert.match(rust, /RUNTIME_INVALID/)
assert.match(rust, /MODEL_INVALID/)
assert.match(rust, /--log-disable/)
assert.match(rust, /--offline/)
assert.match(rust, /--cors-origins", "localhost/)
assert.doesNotMatch(rust, /\.arg\(&request_data\.(system|input)\)/)
assert.match(rust, /Duration::from_secs\(5 \* 60\)/)
assert.match(rust, /lifecycle\.queued = lifecycle\.queued\.saturating_add\(1\)/)
assert.match(rust, /!lifecycle\.active\s*&& lifecycle\.queued == 0/)
assert.match(rust, /schedule_idle_shutdown/)
assert.match(rust, /LifecyclePhase::Stopping/)
assert.match(rust, /READY_UNLOADED/)
assert.match(rust, /READY_WARM/)
assert.match(rust, /INFERENCE_ACTIVE/)
assert.match(rust, /IDLE_UNLOADED/)

console.log('PASS managed runtime: full pinned inventory, current-user lifecycle, dynamic authenticated loopback, constrained boundary and no model downloader')
