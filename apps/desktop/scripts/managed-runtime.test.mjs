import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const rust = readFileSync(new URL('../src-tauri/src/managed_companion_runtime.rs', import.meta.url), 'utf8')
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
const model = readFileSync(new URL('../src/services/localCompanionModel.ts', import.meta.url), 'utf8')
const trainer = readFileSync(new URL('../src/services/trainerProposalModel.ts', import.meta.url), 'utf8')
const acquire = readFileSync(new URL('./managed-runtime/acquire-llama-runtime.ps1', import.meta.url), 'utf8')
const differentialAcquire = readFileSync(new URL('./managed-runtime/acquire-differential-b10760.ps1', import.meta.url), 'utf8')
const differential = readFileSync(new URL('./managed-runtime/differential-harness.mjs', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('./managed-runtime/llama-b7081-win-vulkan-x64.manifest.json', import.meta.url), 'utf8'))

assert.match(rust, /TcpListener::bind\("127\.0\.0\.1:0"\)/)
assert.match(rust, /\.env\("LLAMA_ARG_API_KEY", &secret\)/)
assert.match(rust, /invalid-greekgod-instance-token/)
assert.doesNotMatch(rust, /0\.0\.0\.0|--api-key["']/)
assert.doesNotMatch(rust, /AppData|SQLite|ActionDefinitionRegistry|TrackingCommandGateway|sync credential/i)
assert.match(lib, /RunEvent::Exit.*RunEvent::ExitRequested/)
assert.match(lib, /managed_companion_runtime::shutdown/)
assert.match(trainer, /managedCompanionModel/)
assert.doesNotMatch(trainer, /=\s*localCompanionModel\b|Ollama/)
assert.match(rust, /response_format/) // provider request uses constrained JSON schema
assert.match(model, /jsonSchema/) // provider-neutral request carries that schema to the runtime
assert.doesNotMatch(acquire, /Phi|gguf|MODEL_SHA/i) // runtime acquisition never downloads a model
assert.match(differentialAcquire, /b10760/)
assert.match(differentialAcquire, /34dfb5aab953a1e69faf0fc185edda10ff08e515f5607f7b8cdda740b1ed88cb/)
assert.doesNotMatch(differentialAcquire, /Phi|gguf|MODEL_SHA/i)
assert.match(differential, /syntheticOnly !== true/)
assert.match(differential, /Ollama endpoint must be loopback/)
assert.match(differential, /renderPhi/)
assert.match(differential, /json_schema/)
assert.doesNotMatch(differential, /AppData|Users\\|GreekGodDev|TrackingCommandGateway|ActionDefinitionRegistry/)
assert.equal(manifest.release, 'b7081')
assert.equal(manifest.commit, '80deff3648b93727422461c41c7279ef1dac7452')
assert.equal(manifest.files.length, 37)
for (const file of manifest.files) {
  assert.match(file.sha256, /^[a-f0-9]{64}$/)
  assert.match(rust, new RegExp(`\\("${file.name.replaceAll('.', '\\.')}"\\s*,\\s*"${file.sha256}"\\)`))
}
assert.match(rust, /RUNTIME_INCOMPATIBLE/)
assert.match(rust, /MODEL_CHECKSUM_MISMATCH/)
assert.match(rust, /--log-disable/)
assert.doesNotMatch(rust, /\.arg\(&request_data\.(system|input)\)/)

console.log('PASS managed runtime: full pinned inventory, current-user lifecycle, dynamic authenticated loopback, constrained boundary and no model downloader')
