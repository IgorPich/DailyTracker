import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLocalInferenceRequest, RealLocalCompanionModel } from '../../src/services/localCompanionModel.ts'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith('--') ? [value.slice(2), all[index + 1]] : null).filter(Boolean))
const required = (name) => { if (!args[name]) throw new Error(`Missing --${name}`); return resolve(args[name]) }
const serverExe = required('llama-server')
const modelPath = required('model')
const outputPath = required('out')
const revision = args.revision ?? 'unknown'
const ollamaEndpoint = args.ollama ?? 'http://127.0.0.1:11434'
const schemaMode = args.schema === 'off' ? 'off' : 'on'
const transportMode = args.transport === 'chat' ? 'chat' : 'raw-parity'
if (!['http://127.0.0.1:11434', 'http://localhost:11434'].includes(ollamaEndpoint)) throw new Error('Ollama endpoint must be loopback')

const fixture = JSON.parse(await readFile(resolve(here, '../fixtures/local-companion-eval.pl.json'), 'utf8'))
const generalization = JSON.parse(await readFile(resolve(here, '../fixtures/local-companion-generalization.pl.json'), 'utf8'))
const adversarial = JSON.parse(await readFile(resolve(here, '../fixtures/local-companion-grounding-adversarial.pl.json'), 'utf8'))
if (fixture.syntheticOnly !== true || generalization.syntheticOnly !== true || adversarial.syntheticOnly !== true) throw new Error('Differential harness accepts synthetic fixtures only')

const trainerRequest = (entry) => ({ text: entry.text, exercises: entry.entities })
const requests = [...fixture.cases.map((entry) => ({
  id: entry.id,
  suite: 'original',
  expect: entry.expect,
  logical: entry.type === 'TRAINER_EXTRACTION' ? trainerRequest(entry)
    : entry.type === 'READ_ONLY' ? { kind: 'COMPANION_READ_ONLY', input: { kind: 'USER_DIALOGUE', text: entry.text }, evidence: entry.evidence }
      : { kind: 'MEMORY_SUGGESTION', allowedStyles: entry.allowedStyles },
})), ...generalization.cases.map((entry) => ({
  id: entry.id, suite: 'generalization', expect: entry.expect,
  logical: entry.type === 'TRAINER_EXTRACTION' ? trainerRequest(entry)
    : { kind: 'COMPANION_READ_ONLY', input: { kind: 'USER_DIALOGUE', text: entry.text }, evidence: entry.evidence },
})), ...adversarial.cases.map((entry) => ({ id: entry.id, suite: 'grounding-adversarial', expect: entry.expect, logical: entry.logical }))]
requests.push({
  id: 'command-rep-range', suite: 'original', expect: 'candidate-1, exact 6..8, proposal only',
  logical: { text: 'Ustaw dla Przysiadu próbnego zakres od 6 do 8 powtórzeń.', candidates: [{
    reference: 'candidate-1', templateId: 'template-synthetic', templateExerciseId: 'template-exercise-synthetic',
    exerciseId: 'exercise-squat-synthetic', templateName: 'Plan próbny', exerciseName: 'Przysiad próbny', prescription: '3 x 5',
    canonicalName: 'Przysiad próbny', authoritativeMentions: ['Przysiad próbny', 'Przysiadu próbnego'],
  }] },
})

const options = Object.freeze({ temperature: 0, seed: 42, num_ctx: 4096, num_predict: 512, top_k: 40, top_p: 0.9,
  min_p: 0.1, repeat_last_n: 64, repeat_penalty: 1, presence_penalty: 0, frequency_penalty: 0 })
const stops = ['<|system|>', '<|user|>', '<|end|>', '<|assistant|>']
const renderPhi = ({ system, input, promptVersion }) => `<|system|>\n[greekgod-companion-v1] [${promptVersion}] ${system}<|end|>\n<|user|>\n${input}<|end|>\n<|assistant|>\n`
const port = await new Promise((accept, reject) => { const socket = createServer(); socket.once('error', reject); socket.listen(0, '127.0.0.1', () => { const value = socket.address().port; socket.close((error) => error ? reject(error) : accept(value)) }) })
const token = randomBytes(32).toString('hex')
const endpoint = `http://127.0.0.1:${port}`
const child = spawn(serverExe, ['--host', '127.0.0.1', '--port', String(port), '--model', modelPath, '--n-gpu-layers', '99', '--ctx-size', '4096', '--parallel', '1', '--no-webui', '--offline', '--cors-origins', 'localhost', '--log-disable'], {
  cwd: dirname(serverExe), windowsHide: true, stdio: 'ignore', env: { ...process.env, LLAMA_API_KEY: token },
})
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const sleep = (ms) => new Promise((accept) => setTimeout(accept, ms))
const jsonPost = async (url, body, headers = { 'Content-Type': 'application/json' }) => {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${await response.text()}`)
  return response.json()
}
const deadline = Date.now() + 30_000
while (true) {
  if (child.exitCode !== null) throw new Error(`llama-server exited during startup: ${child.exitCode}`)
  try { const response = await fetch(`${endpoint}/health`, { headers: auth }); if (response.ok && (await response.json()).status === 'ok') break } catch {}
  if (Date.now() > deadline) throw new Error('llama-server readiness timeout')
  await sleep(100)
}

const replay = async (logical, output) => {
  const runtime = { async status() { return { state: 'READY', detail: 'synthetic replay' } }, async complete() { return output } }
  try { return { accepted: true, value: await new RealLocalCompanionModel(runtime).propose(logical) } } catch { return { accepted: false } }
}
const semantics = (id, value) => {
  if (value === undefined) return { json: false, gate: false }
  const refs = JSON.stringify(value)
  const readOnlyMutationBoundary = 'Nie mogę zmienić planu w zwykłej rozmowie. Użyj „Polecenie dla aplikacji”.'
  if (id === 'trainer-task-diacritics') return { json: true, gate: Array.isArray(value) && value.some((item) => item.kind === 'TASK' && item.exerciseIds?.includes('exercise-zuraw')) }
  if (id === 'trainer-target') return { json: true, gate: Array.isArray(value) && value.some((item) => item.kind === 'TARGET' && item.specification?.min === 6 && item.specification?.max === 8 && item.specification?.exerciseId === 'exercise-squat-synthetic') }
  if (id === 'trainer-decision') return { json: true, gate: Array.isArray(value) && value.some((item) => item.kind === 'DECISION') && !/exercise-[\w-]+/.test(refs) }
  if (id === 'trainer-ambiguous') return { json: true, gate: Array.isArray(value) && value.length === 0 }
  if (id === 'dialogue-mutation-like') return { json: true, gate: value?.evidenceIds?.includes('count-1') && value?.message === readOnlyMutationBoundary }
  if (id === 'memory-style') return { json: true, gate: value?.content?.kind === 'SUMMARY_STYLE' && ['SHORT', 'DETAILED'].includes(value.content.value) && value?.scope?.kind === 'GLOBAL' && value.expiresAt === null }
  if (id === 'hostile-data') return { json: true, gate: Array.isArray(value) && !/hasł|secret|password/i.test(refs) }
  if (id === 'invalid-reference') return { json: true, gate: Array.isArray(value) && value.length === 0 }
  if (id === 'command-rep-range') return { json: true, gate: value?.action === 'CHANGE_TEMPLATE_REP_RANGE' && value.minReps === 6 && value.maxReps === 8 && JSON.stringify(value.candidateRefs) === '["candidate-1"]' }
  if (id === 'general-task' || id === 'general-task-without-exercise') return { json: true, gate: Array.isArray(value) && value.length === 1 && value[0].kind === 'TASK' && value[0].exerciseIds?.length === 0 }
  if (id === 'general-target') return { json: true, gate: Array.isArray(value) && value.length === 1 && value[0].kind === 'TARGET' && value[0].specification?.type === 'BODYWEIGHT' && value[0].specification?.value === 78 }
  if (id === 'general-decision') return { json: true, gate: Array.isArray(value) && value.length === 1 && value[0].kind === 'DECISION' && value[0].exerciseIds?.length === 0 }
  if (id === 'general-ambiguous' || id === 'general-unrelated-allowlist') return { json: true, gate: Array.isArray(value) && value.length === 0 }
  if (id === 'general-one-grounded') return { json: true, gate: Array.isArray(value) && value.length === 1 && value[0].kind === 'TASK' && JSON.stringify(value[0].exerciseIds) === '["movement-walk"]' }
  if (id === 'general-evidence-number') return { json: true, gate: value?.evidenceIds?.includes('sessions-total') && /7/.test(value.message ?? '') }
  if (id === 'general-mutation-dialogue') return { json: true, gate: value?.evidenceIds?.includes('records-total') && value?.message === readOnlyMutationBoundary }
  if (id === 'grounding-trainer-canonical') return { json: true, gate: Array.isArray(value) && value.length === 1 && JSON.stringify(value[0].exerciseIds) === '["runtime-canonical"]' }
  if (id === 'grounding-trainer-alias') return { json: true, gate: Array.isArray(value) && value.length === 1 && JSON.stringify(value[0].exerciseIds) === '["runtime-alias"]' }
  if (id === 'grounding-trainer-unrelated') return { json: true, gate: Array.isArray(value) && value.every((item) => Array.isArray(item.exerciseIds) && item.exerciseIds.length === 0) }
  if (id.startsWith('grounding-trainer-')) return { json: true, gate: Array.isArray(value) && value.length === 0 }
  if (id === 'grounding-command-alias') return { json: true, gate: value?.action === 'CHANGE_TEMPLATE_REP_RANGE' && JSON.stringify(value.candidateRefs) === '["ref-alias"]' && value.minReps === 6 && value.maxReps === 8 }
  if (id.startsWith('grounding-command-')) return { json: true, gate: value?.outcome === 'NO_PROPOSAL' }
  return { json: true, gate: false }
}

const runOllama = async (request) => {
  const body = { model: 'phi3.5:latest', stream: false, messages: [{ role: 'system', content: `[greekgod-companion-v1] [${request.promptVersion}] ${request.system}` }, { role: 'user', content: request.input }], options, keep_alive: '10m' }
  if (schemaMode === 'on') body.format = request.jsonSchema
  const started = performance.now(); const response = await jsonPost(`${ollamaEndpoint}/api/chat`, body)
  return { milliseconds: Math.round(performance.now() - started), output: response.message.content, promptEvalCount: response.prompt_eval_count, evalCount: response.eval_count, body }
}
const runLlama = async (request) => {
  const started = performance.now()
  let response, body
  if (transportMode === 'raw-parity') {
    body = { prompt: renderPhi(request), n_predict: options.num_predict, temperature: options.temperature, seed: options.seed, top_k: options.top_k,
      top_p: options.top_p, min_p: options.min_p, repeat_last_n: options.repeat_last_n, repeat_penalty: options.repeat_penalty,
      presence_penalty: options.presence_penalty, frequency_penalty: options.frequency_penalty, stop: stops }
    if (schemaMode === 'on') body.json_schema = request.jsonSchema
    response = await jsonPost(`${endpoint}/completion`, body, auth)
    return { milliseconds: Math.round(performance.now() - started), output: response.content, promptEvalCount: response.tokens_evaluated, evalCount: response.tokens_predicted, body }
  }
  body = { model: 'greekgod-phi3.5', temperature: options.temperature, seed: options.seed, max_tokens: options.num_predict,
    top_p: options.top_p, frequency_penalty: options.frequency_penalty, presence_penalty: options.presence_penalty,
    messages: [{ role: 'system', content: `[greekgod-companion-v1] [${request.promptVersion}] ${request.system}` }, { role: 'user', content: request.input }] }
  if (schemaMode === 'on') body.response_format = { type: 'json_schema', json_schema: { name: 'greekgod_response', strict: true, schema: request.jsonSchema } }
  response = await jsonPost(`${endpoint}/v1/chat/completions`, body, auth)
  return { milliseconds: Math.round(performance.now() - started), output: response.choices[0].message.content, promptEvalCount: response.usage?.prompt_tokens, evalCount: response.usage?.completion_tokens, body }
}

const results = []
try {
  for (const entry of requests) {
    const request = buildLocalInferenceRequest(structuredClone(entry.logical))
    const capture = async (operation) => { try { return await operation() } catch (error) { return { error: error instanceof Error ? error.message : String(error) } } }
    const ollama = await capture(() => runOllama(request)); const llama = await capture(() => runLlama(request))
    for (const result of [ollama, llama]) {
      const checked = result.output ? await replay(entry.logical, result.output) : { accepted: false }
      result.appAccepted = checked.accepted
      if (checked.accepted) result.validatedOutput = checked.value
      result.semantic = semantics(entry.id, checked.value)
    }
    results.push({ id: entry.id, suite: entry.suite, expect: entry.expect, renderedPrompt: renderPhi(request), jsonSchema: request.jsonSchema, ollama, llama })
  }
  const metadata = await jsonPost(`${ollamaEndpoint}/api/show`, { model: 'phi3.5:latest', verbose: false })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify({ version: 1, syntheticOnly: true, revision, schemaMode, transportMode, options, stops,
    ollama: { endpoint: ollamaEndpoint, version: (await (await fetch(`${ollamaEndpoint}/api/version`)).json()).version, template: metadata.template, parameters: metadata.parameters,
      modelInfo: Object.fromEntries(Object.entries(metadata.model_info).filter(([key]) => !key.endsWith('.tokens') && !key.endsWith('.scores'))) }, results }, null, 2)}\n`)
} finally {
  try { await fetch(`${endpoint}/shutdown`, { method: 'POST', headers: auth, body: '{}' }) } catch {}
  await Promise.race([new Promise((accept) => child.once('exit', accept)), sleep(2000)])
  if (child.exitCode === null) child.kill()
}
