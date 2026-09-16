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
  const runtime = new StubRuntime('[{"kind":"TASK","title":"Zapisz wynik","entityGroundings":[{"exerciseId":"ex-ż","mention":"Żuraw"}]}]')
  const model = new RealLocalCompanionModel(runtime)
  assert.deepEqual(await model.propose({ text: 'Zapisz wynik: Żuraw.', exercises: [{ id: 'ex-ż', name: 'Żuraw' }] }),
    [{ kind: 'TASK', title: 'Zapisz wynik', exerciseIds: ['ex-ż'] }])
  assert.equal(runtime.request?.promptVersion, 'greekgod-trainer-v2')
  const sent = JSON.parse(runtime.request!.input)
  assert.deepEqual({ ...sent, sourceMentionOptions: undefined }, { text: 'Zapisz wynik: Żuraw.', exercises: [{ id: 'ex-ż', name: 'Żuraw' }], clearKind: 'TASK', clearTargetMeasure: null, exactGroundedExercises: [{ id: 'ex-ż', name: 'Żuraw' }], explicitRange: null, sourceMentionOptions: undefined })
  assert.ok(sent.sourceMentionOptions.includes('Żuraw'))
  assert.doesNotMatch(runtime.request!.input, /dailyEntries|workouts|templates|calorieTarget/)
})

test('malformed prose and unsupported request fail without retry or fallback mutation', async () => {
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('```json\n{}\n```')).propose({ kind: 'MEMORY_SUGGESTION', allowedStyles: ['SHORT', 'DETAILED'] }))
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('{}')).propose({ appData: {} }))
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('[]')).propose({ text: 'synthetic', exercises: [], appData: { private: true } }))
})

test('closed validators reject unknown fields, invalid refs and semantic ranges before returning', async () => {
  const trainer = { text: 'synthetic', exercises: [{ id: 'allowed', name: 'Dozwolone' }] }
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('[{"kind":"TASK","title":"X","entityGroundings":[{"exerciseId":"unknown","mention":"X"}]}]')).propose(trainer))
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('[{"kind":"TASK","title":"X","entityGroundings":[],"action":"WRITE"}]')).propose(trainer))
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('{"action":"CHANGE_TEMPLATE_REP_RANGE","candidateRefs":["r"],"minReps":9,"maxReps":3}')).propose({
    text: 'synthetic', candidates: [{ reference: 'r', templateId: 't', templateExerciseId: 'row', exerciseId: 'e', templateName: 'T', exerciseName: 'E', prescription: '1x1' }],
  }))
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('{"message":"ok","evidenceIds":["other"]}')).propose({
    kind: 'COMPANION_READ_ONLY', input: { kind: 'USER_DIALOGUE', text: 'x' }, evidence: [{ id: 'ev', text: 'fact' }],
  }))
})

test('adapter accepts multiple exact allowed trainer IDs for the downstream domain validator to apply its contract', async () => {
  const output = '[{"kind":"TASK","title":"Dwa jawne ćwiczenia","entityGroundings":[{"exerciseId":"a","mention":"Ćwiczenie A"},{"exerciseId":"b","mention":"Ćwiczenie B"}]}]'
  assert.deepEqual(await new RealLocalCompanionModel(new StubRuntime(output)).propose({ text: 'Zapisz Ćwiczenie A oraz Ćwiczenie B', exercises: [
    { id: 'a', name: 'Ćwiczenie A' }, { id: 'b', name: 'Ćwiczenie B' },
  ] }), [{ kind: 'TASK', title: 'Dwa jawne ćwiczenia', exerciseIds: ['a', 'b'] }])
})

test('provider schema constrains all model-returned references to request allowlists', async () => {
  const trainerRuntime = new StubRuntime('[{"kind":"TASK","title":"Jawne","entityGroundings":[{"exerciseId":"a","mention":"A"},{"exerciseId":"b","mention":"B"}]}]')
  await new RealLocalCompanionModel(trainerRuntime).propose({ text: 'Zapisz A oraz B', exercises: [
    { id: 'a', name: 'A' }, { id: 'b', name: 'B' },
  ] })
  const proposal = ((trainerRuntime.request!.jsonSchema.items as { oneOf: Array<{ properties: Record<string, unknown> }> }).oneOf[0])
  assert.deepEqual(proposal.properties.entityGroundings, {
    type: 'array', maxItems: 2, uniqueItems: true, items: { oneOf: [
      { type: 'object', additionalProperties: false, required: ['exerciseId', 'mention'], properties: { exerciseId: { const: 'a' }, mention: { const: 'A' } } },
      { type: 'object', additionalProperties: false, required: ['exerciseId', 'mention'], properties: { exerciseId: { const: 'b' }, mention: { const: 'B' } } },
    ] },
  })

  const commandRuntime = new StubRuntime('{"action":"CHANGE_TEMPLATE_REP_RANGE","candidate":{"reference":"r","sourceMention":"E"},"minReps":6,"maxReps":8}')
  await new RealLocalCompanionModel(commandRuntime).propose({ text: 'Ustaw E od 6 do 8 powtórzeń', candidates: [
    { reference: 'r', templateId: 't', templateExerciseId: 'te', exerciseId: 'e', templateName: 'T', exerciseName: 'E', prescription: '3x8' },
  ] })
  const success = (commandRuntime.request!.jsonSchema.oneOf as Array<{ properties: Record<string, unknown> }>)[0]
  assert.deepEqual(success.properties.candidate, {
    oneOf: [{ type: 'object', additionalProperties: false, required: ['reference', 'sourceMention'], properties: { reference: { const: 'r' }, sourceMention: { const: 'E' } } }],
  })
})

test('ephemeral grounding and numeric hints cannot force a kind or unrelated entity', async () => {
  const numeric = new StubRuntime('[]')
  assert.deepEqual(await new RealLocalCompanionModel(numeric).propose({
    text: 'W notatce pojawiają się liczby od 6 do 8, bez propozycji.', exercises: [{ id: 'only', name: 'Ćwiczenie próbne' }],
  }), [])
  assert.equal((numeric.request!.jsonSchema as { maxItems?: number }).maxItems, 0)

  const unrelated = new StubRuntime('[]')
  assert.deepEqual(await new RealLocalCompanionModel(unrelated).propose({
    text: 'Dodaj zadanie dla ruchu spoza listy.', exercises: [{ id: 'only', name: 'Ćwiczenie próbne' }],
  }), [])

  const ambiguous = new StubRuntime('[]')
  assert.deepEqual(await new RealLocalCompanionModel(ambiguous).propose({
    text: 'Dodaj zadanie dla ruchu próbnego.', exercises: [{ id: 'a', name: 'Ruch próbny A' }, { id: 'b', name: 'Ruch próbny B' }],
  }), [])

  const next = new StubRuntime('[{"kind":"TASK","title":"Jawne","entityGroundings":[{"exerciseId":"new","mention":"Nowy ruch"}]}]')
  await new RealLocalCompanionModel(next).propose({ text: 'Zapisz Nowy ruch.', exercises: [{ id: 'new', name: 'Nowy ruch' }] })
  assert.doesNotMatch(next.request!.input, /Ćwiczenie próbne|"only"|Ruch próbny/)
})

test('trainer targets must use a value and measurement kind supported by the current source', async () => {
  const request = { text: 'Celem jest masa ciała 78 kg.', exercises: [] }
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('[{"kind":"TARGET","title":"Cel","specification":{"type":"BODYWEIGHT","scope":"PERSON","value":79,"unit":"kg"}}]')).propose(request))
  await assert.rejects(new RealLocalCompanionModel(new StubRuntime('[{"kind":"TARGET","title":"Cel","specification":{"type":"WAIST","scope":"PERSON","value":78,"unit":"cm"}}]')).propose(request))
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
