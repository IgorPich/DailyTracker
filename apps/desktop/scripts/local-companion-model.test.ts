import assert from 'node:assert/strict'
import test from 'node:test'
import { LOCAL_MODEL, RealLocalCompanionModel, type LocalInferenceRequest, type LocalInferenceRuntime } from '../src/services/localCompanionModel.ts'

class StubRuntime implements LocalInferenceRuntime {
  request?: LocalInferenceRequest
  private readonly output: string
  constructor(output: string) { this.output = output }
  async status() { return { state: 'READY' as const, detail: 'synthetic' } }
  async complete(request: LocalInferenceRequest) { this.request = request; return this.output }
}

test('real adapter sends only the bounded trainer request and returns untrusted JSON', async () => {
  const runtime = new StubRuntime('[{"kind":"TASK","title":"Zapisz wynik","exerciseIds":["ex-ż"]}]')
  const model = new RealLocalCompanionModel(runtime)
  assert.deepEqual(await model.propose({ text: 'Zapisz wynik żurawia.', exercises: [{ id: 'ex-ż', name: 'Żuraw' }] }),
    [{ kind: 'TASK', title: 'Zapisz wynik', exerciseIds: ['ex-ż'] }])
  assert.equal(runtime.request?.promptVersion, 'greekgod-companion-v1')
  assert.deepEqual(JSON.parse(runtime.request!.input), { text: 'Zapisz wynik żurawia.', exercises: [{ id: 'ex-ż', name: 'Żuraw' }] })
  assert.doesNotMatch(runtime.request!.input, /dailyEntries|workouts|templates|calorieTarget/)
})

test('malformed prose and unsupported request fail without retry or fallback mutation', async () => {
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('```json\n{}\n```')).propose({ kind: 'MEMORY_SUGGESTION', allowedStyles: ['SHORT', 'DETAILED'] }))
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('{}')).propose({ appData: {} }))
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('[]')).propose({ text: 'synthetic', exercises: [], appData: { private: true } }))
})

test('closed validators reject unknown fields, invalid refs and semantic ranges before returning', async () => {
  const trainer = { text: 'synthetic', exercises: [{ id: 'allowed', name: 'Dozwolone' }] }
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('[{"kind":"TASK","title":"X","exerciseIds":["unknown"]}]')).propose(trainer))
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('[{"kind":"TASK","title":"X","exerciseIds":[],"action":"WRITE"}]')).propose(trainer))
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('{"action":"CHANGE_TEMPLATE_REP_RANGE","candidateRefs":["r"],"minReps":9,"maxReps":3}')).propose({
    text: 'synthetic', candidates: [{ reference: 'r', templateId: 't', templateExerciseId: 'row', exerciseId: 'e', templateName: 'T', exerciseName: 'E', prescription: '1x1' }],
  }))
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('{"message":"ok","evidenceIds":["other"]}')).propose({
    kind: 'COMPANION_READ_ONLY', input: { kind: 'USER_DIALOGUE', text: 'x' }, evidence: [{ id: 'ev', text: 'fact' }],
  }))
})

test('adapter accepts multiple exact allowed trainer IDs for the downstream domain validator to apply its contract', async () => {
  const output = '[{"kind":"TASK","title":"Dwa jawne ćwiczenia","exerciseIds":["a","b"]}]'
  assert.deepEqual(await new RealLocalCompanionModel(new StubRuntime(output)).propose({ text: 'synthetic', exercises: [
    { id: 'a', name: 'Ćwiczenie A' }, { id: 'b', name: 'Ćwiczenie B' },
  ] }), JSON.parse(output))
})

test('asset identity is versioned and checksum-pinned', () => {
  assert.equal(LOCAL_MODEL.license, 'MIT')
  assert.match(LOCAL_MODEL.manifestSha256, /^[a-f0-9]{64}$/)
  assert.match(LOCAL_MODEL.modelFileSha256, /^[a-f0-9]{64}$/)
  assert.match(LOCAL_MODEL.expectedPath, /%LOCALAPPDATA%/)
  assert.ok(LOCAL_MODEL.approximateBytes > 2_000_000_000)
})

test('pending inference can be cancelled explicitly and fails closed', async () => {
  const runtime: LocalInferenceRuntime = {
    async status() { return { state: 'READY', detail: 'synthetic' } },
    complete(_request, signal) { return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) },
  }
  const model = new RealLocalCompanionModel(runtime)
  const pending = model.propose({ kind: 'MEMORY_SUGGESTION', allowedStyles: ['SHORT', 'DETAILED'] })
  model.cancelPending()
  await assert.rejects(pending, /cancelled/)
})
