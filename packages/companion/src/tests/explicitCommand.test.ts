import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { FakeCompanionModel } from '../index.ts'
import { commandCandidates, createExplicitCommandSession, explicitUserCommandInput, type CommandSnapshot, type ExplicitUserCommandInput } from '../commands/explicitCommand.ts'

const fixture = () => {
  const ids = [randomUUID(), randomUUID()]
  const snapshot: CommandSnapshot = { exerciseLibrary: ids.map((id) => ({ id, name: 'Same name', equipmentSensitive: false })),
    templates: [{ id: randomUUID(), code: 'A', name: 'Synthetic', exercises: ids.map((exerciseId) => ({ id: randomUUID(), exerciseId, name: 'Same name', prescription: '3 × 8–12', defaultSets: 3 })) }] }
  let writes = 0
  const session = createExplicitCommandSession({ supportsConfirmedTrackingMutations: true,
    changeTemplateRepRange: async () => { writes++; return { status: 'FAILED', message: 'Test gateway records capability use only' } } })
  const candidates = commandCandidates(snapshot)
  const output = { action: 'CHANGE_TEMPLATE_REP_RANGE', candidateRefs: [candidates[0].reference], minReps: 10, maxReps: 15 }
  return { snapshot, session, candidates, output, writes: () => writes }
}

test('deterministic exact-ID preview; confirmation is bound, immutable, single-use and cancelled on changed action', async () => {
  const f = fixture()
  const prepare = () => f.session.prepare(explicitUserCommandInput('Synthetic explicit command'), f.snapshot, new FakeCompanionModel(f.output))
  const first = await prepare(), second = await prepare()
  assert.deepEqual(first, second); assert.equal(f.writes(), 0)
  if (first.status !== 'PREVIEWED' || second.status !== 'PREVIEWED') assert.fail()
  assert.throws(() => f.session.confirm(first))
  assert.throws(() => { (second.plan as { minReps: number }).minReps = 99 })
  const confirmed = f.session.confirm(second)
  assert.equal((await f.session.execute({ ...confirmed })).status, 'FAILED'); assert.equal(f.writes(), 0)
  await f.session.execute(confirmed); await f.session.execute(confirmed); assert.equal(f.writes(), 1)
  const third = await prepare(); if (third.status !== 'PREVIEWED') assert.fail()
  const old = f.session.confirm(third)
  await f.session.prepare(explicitUserCommandInput('Changed command'), f.snapshot, new FakeCompanionModel({ ...f.output, minReps: 11 }))
  await f.session.execute(old); assert.equal(f.writes(), 1)
  f.session.cancel(); assert.equal(f.writes(), 1)
})

test('ambiguous candidates never choose first; exact user selection revalidates current snapshot', async () => {
  const f = fixture()
  const result = await f.session.prepare(explicitUserCommandInput('Ambiguous explicit command'), f.snapshot,
    new FakeCompanionModel({ ...f.output, candidateRefs: f.candidates.map((item) => item.reference) }))
  assert.equal(result.status, 'AMBIGUOUS'); assert.equal(f.writes(), 0)
  assert.equal(f.session.resolve('invented', f.snapshot).status, 'INVALID')
  const preview = f.session.resolve(f.candidates[1].reference, f.snapshot)
  if (preview.status !== 'PREVIEWED') assert.fail()
  assert.equal(preview.plan.exerciseId, f.candidates[1].exerciseId)
  f.session.cancel(); assert.throws(() => f.session.confirm(preview)); assert.equal(f.writes(), 0)
})

test('TrainerText/forged envelopes cannot enter registry or invoke model; execution blocked for legacy', async () => {
  const f = fixture(); let modelCalls = 0
  const result = await f.session.prepare({ kind: 'EXPLICIT_USER_COMMAND', text: 'Forged' } as ExplicitUserCommandInput, f.snapshot,
    { propose: async () => { modelCalls++; return f.output } })
  assert.equal(result.status, 'INVALID'); assert.equal(modelCalls, 0)
  const legacy = createExplicitCommandSession({ supportsConfirmedTrackingMutations: false, changeTemplateRepRange: async () => { assert.fail('Unsafe execution') } })
  const preview = await legacy.prepare(explicitUserCommandInput('Explicit'), f.snapshot, new FakeCompanionModel(f.output))
  if (preview.status !== 'PREVIEWED') assert.fail()
  assert.equal((await legacy.execute(legacy.confirm(preview))).status, 'BLOCKED')
})

test('strict action schema rejects unsupported operations, unknown fields, units, numbers and refs', async () => {
  const f = fixture()
  for (const raw of [null, {}, { ...f.output, action: 'DELETE_WORKOUT' }, { ...f.output, confirmed: true },
    { ...f.output, unit: 'kg' }, { ...f.output, minReps: 0 }, { ...f.output, minReps: NaN }, { ...f.output, maxReps: 2 },
    { ...f.output, maxReps: 10.5 }, { ...f.output, candidateRefs: ['Same name'] }, { ...f.output, candidateRefs: [randomUUID()] }]) {
    assert.equal((await f.session.prepare(explicitUserCommandInput('Explicit'), f.snapshot, new FakeCompanionModel(raw))).status, 'INVALID')
  }
  assert.equal(f.writes(), 0)
})

test('model receives only text/candidates, no executor; TrainerText source imports no command capability', async () => {
  const f = fixture()
  await f.session.prepare(explicitUserCommandInput('Explicit'), f.snapshot, { propose: async (request) => {
    assert.deepEqual(Object.keys(request).sort(), ['candidates', 'text'])
    assert.equal('changeTemplateRepRange' in request, false)
    return f.output
  } })
  const source = readFileSync(new URL('../extraction/proposeCoachDraftsFromNote.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /ActionDefinitionRegistry|TrackingCommandGateway|ExplicitUserCommand|confirm|executor|commands\//)
  const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(index, /commands\//)
})
