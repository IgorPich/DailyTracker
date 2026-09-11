import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { createHumanCoach, emptyHumanCoachContext, validateHumanCoachContext, type HumanCoachContext, type HumanCoachRepository } from '../index.ts'

const at = '2026-01-01T10:00:00.000Z'
const later = '2026-01-02T10:00:00.000Z'
const manual = { sourceType: 'MANUAL' as const, createdAt: at, sourceReference: 'External trainer' }
const setup = (ids: string[] = []) => {
  let state = emptyHumanCoachContext()
  const repository: HumanCoachRepository = {
    read: async () => structuredClone(state),
    update: async (change) => {
      const next = change(structuredClone(state))
      validateHumanCoachContext(next)
      state = structuredClone(next)
      return structuredClone(state)
    },
  }
  return createHumanCoach(repository, { readExerciseIds: () => ids })
}

test('source note is exact, immutable through commands and detached reads', async () => {
  const app = setup()
  const text = '  Original trainer text\nwith whitespace.  '
  await app.createCoachNote({ id: 'note', provenance: manual, text })
  const context = await app.listContext()
  ;(context.items[0] as { text: string }).text = 'tampered'
  await app.acceptCoachItem({ id: 'note', acceptedAt: later })
  assert.equal((await app.listCoachNotes())[0].text, text)
  await assert.rejects(app.createCoachNote({ id: 'note', provenance: manual, text: 'replacement' }))
  assert.equal((await app.listCoachNotes())[0].text, text)
})

test('trainer-derived task links the immutable source and requires explicit acceptance', async () => {
  const app = setup()
  await app.createCoachNote({ id: 'source', text: 'Source', provenance: { ...manual, sourceType: 'TRAINER_TEXT' } })
  const provenance = { ...manual, sourceType: 'TRAINER_TEXT' as const, sourceNoteId: 'source' }
  await app.createCoachTask({ id: 'task', title: 'Objective', exerciseIds: [], provenance })
  assert.equal((await app.listContext()).items[1].provenance.sourceNoteId, 'source')
  assert.equal((await app.listAuthoritativeContext()).items.length, 0)
  await assert.rejects(app.updateCoachTaskStatus({ id: 'task', status: 'COMPLETED', changedAt: later }))
  await app.acceptCoachItem({ id: 'task', acceptedAt: later })
  assert.equal((await app.listAuthoritativeContext()).items.length, 1)
  await assert.rejects(app.acceptCoachItem({ id: 'task', acceptedAt: later }))
})

test('source linkage rejects missing notes and trainer text without a note', async () => {
  const app = setup()
  for (const sourceNoteId of [undefined, 'missing']) {
    await assert.rejects(app.createCoachDecision({ id: randomUUID(), text: 'Decision', exerciseIds: [], provenance: { ...manual, sourceType: 'TRAINER_TEXT', sourceNoteId } }))
  }
})

test('task transitions are explicit, audited and can be reopened', async () => {
  const app = setup()
  await app.createCoachTask({ id: 'task', title: 'Task', exerciseIds: [], provenance: manual })
  await app.acceptCoachItem({ id: 'task', acceptedAt: at })
  for (const status of ['COMPLETED', 'OPEN', 'CANCELLED'] as const) {
    await app.updateCoachTaskStatus({ id: 'task', status, changedAt: later, note: 'Manual confirmation' })
  }
  const item = (await app.listContext()).items[0]
  assert.equal(item.kind, 'TASK')
  if (item.kind !== 'TASK') throw new Error('Expected task')
  assert.equal(item.status, 'CANCELLED')
  assert.deepEqual(item.statusHistory.map((change) => change.status), ['COMPLETED', 'OPEN', 'CANCELLED'])
  await assert.rejects(app.updateCoachTaskStatus({ id: 'task', status: 'CANCELLED', changedAt: later }))
  await assert.rejects(app.updateCoachTaskStatus({ id: 'task', status: 'OPEN', changedAt: at }))
})

test('runtime-generated exact IDs stay independent despite equal names and aliases; Tracking untouched', async () => {
  const tracking = { definitions: [randomUUID(), randomUUID()].map((id) => ({ id, name: 'Same', aliases: ['Same alias'] })) }
  const before = structuredClone(tracking)
  const app = setup(tracking.definitions.map((x) => x.id))
  for (const { id } of tracking.definitions) {
    await app.createCoachTask({ id: randomUUID(), title: 'Objective', exerciseIds: [id], provenance: manual })
  }
  for (const id of ['Same', 'Same alias', randomUUID()]) {
    await assert.rejects(app.createCoachTask({ id: randomUUID(), title: 'Objective', exerciseIds: [id], provenance: manual }))
  }
  assert.deepEqual((await app.listContext()).items.map((x) => x.kind === 'TASK' && x.exerciseIds), tracking.definitions.map((x) => [x.id]))
  assert.deepEqual(tracking, before)
})

test('duplicate or deleted canonical definitions are never silently accepted', async () => {
  const id = randomUUID()
  const ids = [id]
  const app = setup(ids)
  await app.createCoachDecision({ id: 'decision', text: 'Trainer decision', exerciseIds: [id], provenance: manual })
  ids.push(id)
  await assert.rejects(app.acceptCoachItem({ id: 'decision', acceptedAt: later }))
  ids.splice(0)
  await assert.rejects(app.acceptCoachItem({ id: 'decision', acceptedAt: later }))
  assert.equal((await app.listContext()).items[0].acceptance.state, 'DRAFT')
})

test('constrained target types stay drafts and retirement never changes Tracking', async () => {
  const exerciseId = randomUUID()
  const app = setup([exerciseId])
  for (const specification of [
    { type: 'BODYWEIGHT', scope: 'PERSON', value: 80, unit: 'kg' },
    { type: 'WAIST', scope: 'PERSON', value: 85, unit: 'cm' },
    { type: 'REP_RANGE', scope: 'EXERCISE', exerciseId, min: 6, max: 10, unit: 'reps' },
  ] as const) {
    const id = randomUUID()
    await app.createCoachTarget({ id, title: 'Trainer target', specification, provenance: manual })
    await assert.rejects(app.retireCoachTarget({ id, retiredAt: later }))
    await app.acceptCoachItem({ id, acceptedAt: at })
    await app.retireCoachTarget({ id, retiredAt: later })
  }
  await assert.rejects(app.createCoachTarget({ id: 'bad', title: 'Bad', provenance: manual, specification: { type: 'REP_RANGE', scope: 'EXERCISE', exerciseId, min: 10, max: 6, unit: 'reps' } }))
})

test('corrupt persistence cannot manufacture accepted state or unsupported target semantics', () => {
  for (const value of [null, {}, { version: 2, items: [] }, { version: 1, items: [{}] }]) {
    assert.throws(() => validateHumanCoachContext(value))
  }
  const data: HumanCoachContext = { version: 1, items: [{ kind: 'NOTE', id: 'n', text: 'Source', createdAt: at, provenance: manual, acceptance: { state: 'AUTHORITATIVE', acceptedAt: 'invalid' } }] }
  assert.throws(() => validateHumanCoachContext(data))
})

test('domain/application/ports have no Analytics, React, Companion, storage or Tracking implementation imports', () => {
  for (const dir of ['domain', 'application', 'ports']) {
    const root = new URL(`../${dir}/`, import.meta.url)
    for (const file of readdirSync(root)) {
      const source = readFileSync(new URL(file, root), 'utf8')
      assert.doesNotMatch(source, /from\s+['"](?:@greekgod\/|react|.*(?:sqlite|companion|tauri))|localStorage|fetch\(/i)
    }
  }
})
