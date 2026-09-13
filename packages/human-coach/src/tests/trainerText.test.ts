import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createHumanCoach, emptyHumanCoachContext, validateHumanCoachContext, type HumanCoachRepository } from '../index.ts'

const at = '2024-03-01T12:00:00.000Z'
const setup = () => {
  const tracking = { exerciseLibrary: [{ id: randomUUID(), name: 'Same name' }, { id: randomUUID(), name: 'Same name' }], workouts: [], templates: [] }
  const before = structuredClone(tracking)
  let state = emptyHumanCoachContext()
  const repository: HumanCoachRepository = {
    read: async () => structuredClone(state),
    update: async (change) => { const next = change(structuredClone(state)); validateHumanCoachContext(next); state = structuredClone(next); return structuredClone(state) },
  }
  return { app: createHumanCoach(repository, { readExerciseIds: () => tracking.exerciseLibrary.map((item) => item.id) }), tracking, before }
}

test('ingestion preserves exact source, rejects whitespace, never parses or deduplicates', async () => {
  const { app, tracking, before } = setup()
  for (const text of ['', ' \r\n\t ']) await assert.rejects(app.ingestTrainerText({ id: randomUUID(), text, createdAt: at }))
  const text = '  Unknown exercise! Do something\r\n\tExact spacing.\n '
  const id = randomUUID()
  await app.ingestTrainerText({ id, text, createdAt: at, sourceDescription: 'Message' })
  const first = await app.listContext()
  assert.equal(first.items.length, 1)
  assert.equal(first.items[0].kind, 'NOTE')
  assert.deepEqual(first.items[0].provenance, { sourceType: 'TRAINER_TEXT', createdAt: at, sourceReference: 'Message' })
  await assert.rejects(app.ingestTrainerText({ id, text: 'Overwrite', createdAt: at }))
  await assert.rejects(app.discardCoachDraft({ id }))
  await app.ingestTrainerText({ id: randomUUID(), text, createdAt: at })
  const notes = await app.listCoachNotes()
  assert.equal(notes.length, 2)
  assert.notEqual(notes[0].id, notes[1].id)
  assert.equal(notes[0].text, text)
  assert.equal(notes[1].text, text)
  assert.deepEqual(tracking, before)
})

test('all manual draft kinds preserve exact source, require acceptance and can be discarded without deleting source', async () => {
  const { app, tracking, before } = setup()
  const sourceNoteId = randomUUID()
  await app.ingestTrainerText({ id: sourceNoteId, text: 'Original', createdAt: at })
  const base = { sourceNoteId, createdAt: at }
  const task = randomUUID(), target = randomUUID(), decision = randomUUID()
  await app.createDraftFromNote({ ...base, id: task, kind: 'TASK', title: 'Manual task', exerciseIds: [tracking.exerciseLibrary[0].id] })
  await app.createDraftFromNote({ ...base, id: target, kind: 'TARGET', title: 'Manual target', specification: { type: 'REP_RANGE', scope: 'EXERCISE', exerciseId: tracking.exerciseLibrary[1].id, min: 3, max: 6, unit: 'reps' } })
  await app.createDraftFromNote({ ...base, id: decision, kind: 'DECISION', text: 'Manual decision', exerciseIds: [] })
  const drafts = (await app.listContext()).items.slice(1)
  for (const item of drafts) {
    assert.deepEqual(item.acceptance, { state: 'DRAFT' })
    assert.equal(item.provenance.sourceNoteId, sourceNoteId)
    assert.equal(item.provenance.sourceType, 'TRAINER_TEXT')
  }
  assert.deepEqual(drafts[0].kind === 'TASK' && drafts[0].exerciseIds, [tracking.exerciseLibrary[0].id])
  assert.equal(drafts[1].kind === 'TARGET' && drafts[1].specification.type === 'REP_RANGE' && drafts[1].specification.exerciseId, tracking.exerciseLibrary[1].id)
  assert.equal((await app.listAuthoritativeContext()).items.length, 0)
  await assert.rejects(app.updateCoachTaskStatus({ id: task, status: 'COMPLETED', changedAt: at }))
  await app.acceptCoachItem({ id: task, acceptedAt: at })
  await assert.rejects(app.discardCoachDraft({ id: task }))
  await app.discardCoachDraft({ id: target })
  await app.discardCoachDraft({ id: decision })
  assert.equal((await app.listCoachNotes())[0].text, 'Original')
  assert.equal((await app.listAuthoritativeContext()).items.length, 1)
  assert.deepEqual(tracking, before)
})

test('source and exercise links fail closed; supplied acceptance cannot bypass draft creation', async () => {
  const { app } = setup()
  const sourceNoteId = randomUUID()
  await app.ingestTrainerText({ id: sourceNoteId, text: 'Source', createdAt: at })
  const command = { kind: 'DECISION' as const, id: randomUUID(), sourceNoteId, createdAt: at, text: 'Manual', exerciseIds: [] }
  await assert.rejects(app.createDraftFromNote({ ...command, sourceNoteId: randomUUID() }))
  await assert.rejects(app.createDraftFromNote({ ...command, exerciseIds: ['Same name'] }))
  await app.createDraftFromNote({ ...command, ...{ acceptance: { state: 'AUTHORITATIVE', acceptedAt: at } } })
  assert.equal((await app.listContext()).items[1].acceptance.state, 'DRAFT')
  await assert.rejects(app.createDraftFromNote({ ...command, id: randomUUID(), sourceNoteId: command.id }))
})
