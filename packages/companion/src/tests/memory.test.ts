import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { FakeCompanionModel } from '../model/fakeCompanionModel.ts'
import { createMemoryApplication, validateMemoryState, selectActiveMemory, memoryStatus, withCompanionMemory,
  type MemoryDraft, type MemoryRepository, type MemoryState, type MemoryCandidate } from '../memory/memory.ts'
import { createReadOnlyCompanion, userDialogueInput, spontaneousCompanionTrigger, applicationEventTrigger, type CompanionReadOnlyRequest } from '../readonly/runtime.ts'

const NOW = '2026-01-01T12:00:00.000Z'
const draft = (): MemoryDraft => ({ content: { kind: 'SUMMARY_STYLE', value: 'SHORT' }, scope: { kind: 'GLOBAL' }, expiresAt: null })
const fixture = () => {
  let state: MemoryState = { version: 1, items: [] }, writes = 0
  const refs = { exerciseIds: [randomUUID(), randomUUID()], coachItemIds: [randomUUID()] }
  const repo: MemoryRepository = { read: async () => structuredClone(state), update: async (change) => {
    const next = validateMemoryState(await change(structuredClone(state))); state = next; writes++; return structuredClone(next)
  } }
  return { repo, refs, app: createMemoryApplication(repo, async () => refs, () => NOW, randomUUID), writes: () => writes }
}
test('manual acceptance, candidate review and provenance remain explicit and single-use', async () => {
  const f = fixture()
  const candidate = await f.app.propose(new FakeCompanionModel(draft()))
  assert.equal(f.writes(), 0); assert.equal((await f.app.list()).items.length, 0)
  assert.ok(Object.isFrozen(candidate)); assert.ok(Object.isFrozen(candidate.draft.content))
  assert.throws(() => f.app.accept({ ...candidate }))
  const accepted = await f.app.accept(candidate)
  assert.equal(accepted.items[0].source, 'COMPANION_SUGGESTED')
  assert.deepEqual(accepted.items[0].provenance, { acceptedBy: 'USER', sourceId: candidate.id })
  assert.throws(() => f.app.accept(candidate)); assert.equal(f.writes(), 1)
  const rejected = await f.app.propose(new FakeCompanionModel(draft()))
  f.app.reject(rejected); assert.throws(() => f.app.accept(rejected)); assert.equal(f.writes(), 1)
  const restarted = createMemoryApplication(f.repo, async () => f.refs, () => NOW, randomUUID)
  assert.deepEqual(await restarted.list(), accepted)
  await f.app.archive(accepted.items[0].id)
  assert.equal((await f.app.reader.readActiveMemory({ kind: 'GLOBAL' }, NOW)).length, 0)
  const manual = await f.app.addExplicit(draft())
  assert.equal(manual.items[1].source, 'USER_EXPLICIT'); assert.equal(manual.items[1].provenance.sourceId, null)
})
test('exact scopes, deleted/ambiguous identities, expiry and deterministic bounded selection', async () => {
  const f = fixture()
  await f.app.addExplicit({ ...draft(), scope: { kind: 'EXERCISE', id: f.refs.exerciseIds[0] }, expiresAt: '2026-01-02T12:00:00.000Z' })
  const query = { kind: 'EXERCISE' as const, id: f.refs.exerciseIds[0] }
  assert.equal((await f.app.reader.readActiveMemory(query, NOW)).length, 1)
  // Display names never enter the scope port; even two definitions named alike are independent.
  assert.equal((await f.app.reader.readActiveMemory({ kind: 'EXERCISE', id: f.refs.exerciseIds[1] }, NOW)).length, 0)
  const state = await f.app.list()
  assert.equal((await f.app.reader.readActiveMemory(query, '2026-01-02T12:00:00.000Z')).length, 0)
  assert.equal(memoryStatus(state.items[0], '2026-01-02T12:00:00.000Z'), 'EXPIRED')
  assert.deepEqual(await f.app.list(), state)
  assert.deepEqual(selectActiveMemory(state, query, NOW, f.refs), selectActiveMemory(state, query, NOW, f.refs))
  f.refs.exerciseIds.push(query.id)
  assert.equal((await f.app.reader.readActiveMemory(query, NOW)).length, 0)
  f.refs.exerciseIds.length = 0
  assert.equal((await f.app.reader.readActiveMemory(query, NOW)).length, 0)
  await assert.rejects(f.app.addExplicit({ ...draft(), scope: query }), /entity/)
  const many = { version: 1 as const, items: Array.from({ length: 12 }, (_, index) => ({ ...state.items[0], id: String(index), scope: { kind: 'GLOBAL' as const } })) }
  assert.equal(selectActiveMemory(many, { kind: 'GLOBAL' }, NOW, f.refs).length, 10)
  assert.throws(() => validateMemoryState({ version: 1, items: Array.from({ length: 101 }, (_, index) => ({ ...many.items[0], id: String(index) })) }))
})
test('HumanCoach memories are exact source references, not duplicated strategy', async () => {
  const f = fixture(), sourceId = f.refs.coachItemIds[0]
  const added = await f.app.addExplicit({ content: { kind: 'HUMAN_COACH_REFERENCE', value: sourceId }, scope: { kind: 'HUMAN_COACH_CONTEXT', id: sourceId }, expiresAt: null })
  assert.equal(added.items[0].source, 'HUMAN_COACH')
  assert.equal(added.items[0].provenance.sourceId, sourceId)
  assert.equal((await f.app.reader.readActiveMemory({ kind: 'GLOBAL' }, NOW)).length, 0)
  assert.equal((await f.app.reader.readActiveMemory({ kind: 'HUMAN_COACH_CONTEXT', id: sourceId }, NOW)).length, 1)
  f.refs.coachItemIds.length = 0
  assert.equal((await f.app.reader.readActiveMemory({ kind: 'HUMAN_COACH_CONTEXT', id: sourceId }, NOW)).length, 0)
  assert.deepEqual(await f.app.list(), added)
})
test('model has no accept/persist capability and malformed/action-bearing candidates are rejected', async () => {
  const f = fixture()
  for (const raw of [{ ...draft(), action: 'CHANGE_TEMPLATE_REP_RANGE' }, { ...draft(), status: 'ACTIVE' },
    { ...draft(), content: { kind: 'AUTOMATIC_COACH_RULE', value: 'anything' } }, { ...draft(), scope: { kind: 'EXERCISE', id: f.refs.exerciseIds[0] } },
    { ...draft(), source: 'USER_EXPLICIT' }]) await assert.rejects(f.app.propose(new FakeCompanionModel(raw)))
  await f.app.propose({ propose: async (request) => {
    assert.deepEqual(Object.keys(request).sort(), ['allowedStyles', 'kind'])
    assert.equal(request.kind, 'MEMORY_SUGGESTION'); return draft()
  } })
  assert.equal(f.writes(), 0)
  assert.throws(() => f.app.accept({ status: 'CANDIDATE', id: randomUUID(), draft: draft() } as MemoryCandidate))
})
test('accepted memory integrates through reader only; dialogue/spontaneous/event cause no writes', async () => {
  const f = fixture()
  await f.app.addExplicit(draft())
  const before = await f.app.list(), writes = f.writes()
  const reader = withCompanionMemory({ readEvidence: async () => [] }, f.app.reader, { kind: 'GLOBAL' }, NOW)
  const evidence = await reader.readEvidence()
  assert.equal(evidence.length, 1); assert.match(evidence[0].text, /USER_EXPLICIT/)
  const model = new FakeCompanionModel<CompanionReadOnlyRequest>({ message: 'Synthetic information', evidenceIds: [evidence[0].id] })
  const runtime = createReadOnlyCompanion(reader, model)
  assert.equal((await runtime.dialogue(userDialogueInput('Change something'))).status, 'MESSAGE')
  assert.equal((await runtime.spontaneous(spontaneousCompanionTrigger())).status, 'MESSAGE')
  assert.equal((await runtime.applicationEvent(applicationEventTrigger('WORKOUT_SAVED'))).status, 'MESSAGE')
  assert.equal(f.writes(), writes); assert.deepEqual(await f.app.list(), before)
})
test('closed persistence rejects hidden fields, bad provenance, dates and duplicate IDs', async () => {
  const f = fixture(); const state = await f.app.addExplicit(draft())
  for (const bad of [{ ...state, version: 2 }, { ...state, promptHistory: [] }, { version: 1, items: [state.items[0], state.items[0]] },
    { version: 1, items: [{ ...state.items[0], source: 'MODEL_AUTO' }] },
    { version: 1, items: [{ ...state.items[0], provenance: { acceptedBy: 'MODEL', sourceId: null } }] },
    { version: 1, items: [{ ...state.items[0], createdAt: '2026-02-30T00:00:00.000Z' }] }]) assert.throws(() => validateMemoryState(bad))
})
test('memory has no Tracking/command/platform imports; command resolution never imports memory', () => {
  for (const file of readdirSync(new URL('../memory/', import.meta.url))) {
    const source = readFileSync(new URL(`../memory/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /ActionDefinitionRegistry|TrackingCommandGateway|ConfirmedActionPlan|AppDataStore|@tauri|node:|fetch\(|invoke\(|\/commands/)
  }
  const commands = readFileSync(new URL('../commands/explicitCommand.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(commands, /\/memory|CompanionMemory/)
})
