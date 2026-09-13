import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { FakeCompanionModel, proposeCoachDraftsFromNote, type ProposeCoachDraftsInput } from '../index.ts'

const input = (): ProposeCoachDraftsInput => {
  const id = randomUUID(), otherId = randomUUID()
  return {
    note: { kind: 'NOTE', id: randomUUID(), text: 'Unknown trainer text', createdAt: '2024-01-01T00:00:00.000Z', provenance: { sourceType: 'TRAINER_TEXT', createdAt: '2024-01-01T00:00:00.000Z' }, acceptance: { state: 'DRAFT' } },
    exercises: [{ id, name: 'Same synthetic name' }, { id: otherId, name: 'Same synthetic name' }], allowedExerciseIds: [id, otherId],
  }
}
const task = { kind: 'TASK', title: 'Synthetic task', exerciseIds: [] }

test('valid configurable fake, deterministic unpersisted exact-ID proposals; no input mutation', async () => {
  const query = input(), before = structuredClone(query)
  const output = query.allowedExerciseIds.map((id) => ({ ...task, exerciseIds: [id] }))
  const fake = new FakeCompanionModel(output)
  const first = await proposeCoachDraftsFromNote(query, fake)
  assert.deepEqual(first, await proposeCoachDraftsFromNote(query, fake))
  assert.deepEqual(first.map((item) => item.sourceNoteId), [query.note.id, query.note.id])
  assert.deepEqual(first.map((item) => item.fields), output)
  assert.deepEqual(query, before)
  assert.equal('acceptance' in first[0], false)
})

for (const bad of [
  null, '[]', {}, [{ kind: 'COMMAND' }], [{ ...task, extra: true }], [{ ...task, sourceNoteId: 'spoof' }],
  [{ ...task, acceptance: { state: 'AUTHORITATIVE' } }], [{ ...task, exerciseIds: ['invented'] }],
  [{ ...task, exerciseIds: ['Same synthetic name'] }], [{ ...task, title: '' }],
  [{ kind: 'TARGET', title: 'Target', specification: { type: 'CALORIES', value: 100 } }],
  [{ kind: 'TARGET', title: 'Target', specification: { type: 'WAIST', scope: 'PERSON', value: Infinity, unit: 'cm' } }],
  [{ kind: 'TARGET', title: 'Target', specification: { type: 'REP_RANGE', scope: 'EXERCISE', exerciseId: null, min: 5, max: 2, unit: 'reps' } }],
  [{ kind: 'TARGET', title: 'Target', specification: { type: 'WAIST', scope: 'PERSON', value: 80, unit: 'cm', extra: 1 } }],
]) {
  test(`whole-response rejection: ${JSON.stringify(bad)}`, async () => {
    await assert.rejects(proposeCoachDraftsFromNote(input(), new FakeCompanionModel(bad)))
  })
}

test('one invalid item rejects the whole response, no partial proposals', async () => {
  await assert.rejects(proposeCoachDraftsFromNote(input(), new FakeCompanionModel([task, { ...task, exerciseIds: ['invented'] }])))
})

test('missing identity is omitted or explicitly unresolved, never guessed', async () => {
  const query = input()
  const fields = { kind: 'TARGET', title: 'Range', specification: { type: 'REP_RANGE', scope: 'EXERCISE', exerciseId: null, min: 3, max: 5, unit: 'reps' } }
  const result = await proposeCoachDraftsFromNote(query, new FakeCompanionModel([task, fields]))
  assert.deepEqual(result.map((item) => item.fields), [task, fields])
})

test('minimal request, provider cannot change allowlist or source binding', async () => {
  const query = input(), sourceId = query.note.id
  await assert.rejects(proposeCoachDraftsFromNote(query, { propose: async (request) => {
    assert.deepEqual(Object.keys(request).sort(), ['exercises', 'text'])
    assert.deepEqual(Object.keys(request.exercises[0]).sort(), ['id', 'name'])
    ;(request.exercises as { id: string; name: string }[]).push({ id: 'invented', name: 'Injected' })
    return [{ ...task, exerciseIds: ['invented'] }]
  } }))
  assert.equal(query.note.id, sourceId)
  assert.equal(query.exercises.length, 2)
})

test('allowlist cannot include unknown, duplicate or ambiguous IDs', async () => {
  const query = input(), fake = new FakeCompanionModel([])
  await assert.rejects(proposeCoachDraftsFromNote({ ...query, allowedExerciseIds: ['unknown'] }, fake))
  await assert.rejects(proposeCoachDraftsFromNote({ ...query, allowedExerciseIds: [query.allowedExerciseIds[0], query.allowedExerciseIds[0]] }, fake))
  await assert.rejects(proposeCoachDraftsFromNote({ ...query, exercises: [...query.exercises, query.exercises[0]] }, fake))
})

test('all supported target kinds and decision accepted with closed units and scope', async () => {
  const query = input()
  const output = [
    { kind: 'DECISION', text: 'Synthetic decision', exerciseIds: [] },
    { kind: 'TARGET', title: 'Synthetic', specification: { type: 'REP_RANGE', scope: 'EXERCISE', exerciseId: query.allowedExerciseIds[0], min: 3, max: 5, unit: 'reps' } },
    { kind: 'TARGET', title: 'Synthetic', specification: { type: 'BODYWEIGHT', scope: 'PERSON', value: 70, unit: 'kg' } },
    { kind: 'TARGET', title: 'Synthetic', specification: { type: 'WAIST', scope: 'PERSON', value: 80, unit: 'cm' } },
  ]
  assert.deepEqual((await proposeCoachDraftsFromNote(query, new FakeCompanionModel(output))).map((item) => item.fields), output)
})

test('closed structured data rejects accessors, sparse arrays and extra array fields', async () => {
  let getterCalls = 0
  const accessor = { kind: 'TASK', get title() { getterCalls++; return 'Bad' }, exerciseIds: [] }
  const extraArray = Object.assign([task], { sourceNoteId: 'spoof' })
  for (const raw of [[accessor], extraArray, new Array(1), Array.from({ length: 21 }, () => task)]) {
    await assert.rejects(proposeCoachDraftsFromNote(input(), { propose: async () => raw }))
  }
  assert.equal(getterCalls, 0)
})

test('Companion runtime has no persistence, platform, commands or reverse dependencies', () => {
  for (const dir of ['extraction', 'model', 'ports', 'validation']) {
    const base = new URL(`../${dir}/`, import.meta.url)
    for (const file of readdirSync(base)) {
      const source = readFileSync(new URL(file, base), 'utf8')
      assert.doesNotMatch(source, /from ['"](?:react|@tauri|node:|@greekgod\/(?:core|analytics))/)
      assert.doesNotMatch(source, /\b(?:fetch|invoke|localStorage|createHumanCoach|acceptCoachItem|createDraftFromNote)\b/)
      for (const line of source.split('\n').filter((line) => line.includes("from '@greekgod/human-coach'"))) assert.match(line, /^import type /)
    }
  }
  for (const pkg of ['core', 'analytics', 'human-coach']) {
    const manifest = readFileSync(new URL(`../../../${pkg}/package.json`, import.meta.url), 'utf8')
    assert.doesNotMatch(manifest, /@greekgod\/companion/)
  }
})
