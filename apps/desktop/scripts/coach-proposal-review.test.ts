import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { FakeCompanionModel, proposeCoachDraftsFromNote } from '@greekgod/companion'
import { createHumanCoach } from '@greekgod/human-coach'
import { LocalHumanCoachRepository } from '../src/services/humanCoachRepository.ts'
import { reviewedProposalCommand } from '../src/utils/coachProposalReview.ts'

test('extraction/rejection/invalid response write nothing; edited acceptance creates only linked DRAFT', async () => {
  let persisted: string | null = null, writes = 0
  const storage = { read: async () => persisted, write: async (text: string) => { persisted = text; writes++ }, exclusive: async <T>(operation: () => Promise<T>) => operation() }
  const firstId = randomUUID(), secondId = randomUUID(), at = '2024-01-01T00:00:00.000Z'
  const tracking = Object.freeze({ exerciseLibrary: Object.freeze([{ id: firstId, name: 'Same name' }, { id: secondId, name: 'Same name' }]), workouts: [], templates: [] })
  const before = structuredClone(tracking)
  const app = createHumanCoach(new LocalHumanCoachRepository(storage), { readExerciseIds: () => tracking.exerciseLibrary.map((item) => item.id) })
  await app.ingestTrainerText({ id: randomUUID(), text: 'Unknown text, not interpreted', createdAt: at })
  const note = (await app.listCoachNotes())[0]
  const input = { note, exercises: tracking.exerciseLibrary, allowedExerciseIds: [firstId, secondId] }
  const baselineWrites = writes, baseline = persisted
  const proposals = await proposeCoachDraftsFromNote(input, new FakeCompanionModel([{ kind: 'TASK', title: 'Synthetic', exerciseIds: [firstId] }]))
  assert.equal(writes, baselineWrites)
  let pending = [...proposals]
  pending = pending.filter((item) => item !== proposals[0]) // Reject is local UI removal only.
  assert.equal(pending.length, 0)
  await assert.rejects(proposeCoachDraftsFromNote(input, new FakeCompanionModel([{ kind: 'TASK', title: 'Valid', exerciseIds: [] }, { kind: 'EXECUTE' }])))
  assert.equal(persisted, baseline)
  assert.equal(writes, baselineWrites)
  const command = reviewedProposalCommand(proposals[0], { kind: 'TASK', title: 'User corrected', description: 'Manual edit', exerciseIds: [secondId] }, randomUUID(), at)
  await app.createDraftFromNote(command)
  const result = await new LocalHumanCoachRepository(storage).read()
  assert.equal(result.items.length, 2)
  const draft = result.items[1]
  assert.equal(draft.provenance.sourceNoteId, note.id)
  assert.equal(draft.provenance.sourceType, 'TRAINER_TEXT')
  assert.equal(draft.acceptance.state, 'DRAFT')
  assert.equal(draft.kind === 'TASK' && draft.title, 'User corrected')
  assert.deepEqual(draft.kind === 'TASK' && draft.exerciseIds, [secondId])
  assert.equal((await app.listAuthoritativeContext()).items.length, 0)
  await app.acceptCoachItem({ id: draft.id, acceptedAt: at })
  assert.equal((await app.listAuthoritativeContext()).items.length, 1)
  assert.deepEqual(tracking, before)
})

test('unresolved target cannot be accepted until explicitly selected; all editable kinds map to existing inputs', () => {
  const sourceNoteId = randomUUID(), exerciseId = randomUUID()
  const fields = { kind: 'TARGET' as const, title: 'Synthetic', specification: { type: 'REP_RANGE' as const, scope: 'EXERCISE' as const, exerciseId: null, min: 3, max: 5, unit: 'reps' as const } }
  const proposal = { sourceNoteId, fields }
  assert.throws(() => reviewedProposalCommand(proposal, fields, randomUUID(), '2024-01-01T00:00:00.000Z'))
  const edited = { ...fields, specification: { ...fields.specification, exerciseId, min: 4, max: 8 } }
  const command = reviewedProposalCommand(proposal, edited, randomUUID(), '2024-01-01T00:00:00.000Z')
  assert.deepEqual(command.kind === 'TARGET' && command.specification, edited.specification)
  assert.equal(command.sourceNoteId, sourceNoteId)
  const decision = reviewedProposalCommand(proposal, { kind: 'DECISION', text: 'Corrected interpretation', exerciseIds: [] }, randomUUID(), '2024-01-01T00:00:00.000Z')
  assert.equal(decision.sourceNoteId, sourceNoteId)
  assert.equal('provenance' in decision, false)
  assert.equal('acceptance' in decision, false)
})

test('Desktop review is explicit, source-bound and uses existing picker, not raw ID editing', () => {
  const page = readFileSync(new URL('../src/pages/HumanCoach.tsx', import.meta.url), 'utf8')
  assert.match(page, /onClick=\{\(\) => void requestProposals\(item.id\)\}/)
  assert.match(page, /service.createDraftFromNote\(reviewedProposalCommand\(reviewing, edited/)
  assert.match(page, /disabled=\{!!reviewing\} value=\{sourceNoteId\}/)
  assert.match(page, /Przyjmij propozycję jako szkic \(DRAFT\)/)
  assert.match(page, /<ExercisePicker/)
  const reject = page.slice(page.indexOf('const rejectProposal'), page.indexOf('const exerciseLabel'))
  assert.doesNotMatch(reject, /service\.|repository|invoke|fetch/)
  assert.doesNotMatch(page, /useEffect\([^\n]*requestProposals/)
})
