import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_TEMPLATES, upsertDailyEntry, type AppData } from '@greekgod/core'
import { applyJournalNumericDraft, appendWorkoutSet, createWorkoutFromTemplate, finalizeWorkout, journalNumericDraft, nextTemplate, upsertWorkoutSet, workoutDestination } from '../src/domain/mobileModel.ts'
import { INITIAL_MOBILE_DATA } from '../src/data/initialData.ts'

test('next workout follows the shared A/B/C/D template order', () => {
  const data = structuredClone(INITIAL_MOBILE_DATA)
  assert.equal(nextTemplate(data)?.code, 'A')
  data.workouts.push({
    id: 'workout-a', date: '2026-08-27', templateId: 'push', templateCode: 'A', templateName: 'PUSH', exercises: [],
  })
  assert.equal(nextTemplate(data)?.code, 'B')
})

test('mobile workout uses stable exerciseId and unique durable set IDs', () => {
  const workout = createWorkoutFromTemplate(DEFAULT_TEMPLATES[0], INITIAL_MOBILE_DATA, '2026-08-27')
  assert.equal(workout.exercises[0].exerciseId, 'bench-press')
  assert.equal(workout.exercises[0].sets.length, 3)
  assert.equal(new Set(workout.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id))).size,
    workout.exercises.reduce((count, exercise) => count + exercise.sets.length, 0))
})

test('a completed set updates its existing workout snapshot without duplication', () => {
  const workout = createWorkoutFromTemplate(DEFAULT_TEMPLATES[0], INITIAL_MOBILE_DATA, '2026-08-27')
  const exercise = workout.exercises[0]
  const set = exercise.sets[0]
  const edited = upsertWorkoutSet(workout, exercise.id, set.id, { weight: 90, reps: 7 })
  assert.equal(edited.id, workout.id)
  assert.equal(edited.exercises.length, workout.exercises.length)
  assert.deepEqual(edited.exercises[0].sets[0], { id: set.id, weight: 90, reps: 7 })
  assert.equal(workout.exercises[0].sets[0].weight, undefined)
})

test('an explicitly added set gets a new durable identity', () => {
  const workout = createWorkoutFromTemplate(DEFAULT_TEMPLATES[0], INITIAL_MOBILE_DATA, '2026-08-27')
  const exercise = workout.exercises[0]
  const edited = appendWorkoutSet(workout, exercise.id)
  assert.equal(edited.exercises[0].sets.length, exercise.sets.length + 1)
  assert.notEqual(edited.exercises[0].sets.at(-1)?.id, exercise.sets.at(-1)?.id)
})

test('mobile journal same-date edit keeps exactly one DailyEntry', () => {
  const data: AppData = structuredClone(INITIAL_MOBILE_DATA)
  data.dailyEntries = upsertDailyEntry(data.dailyEntries, { id: 'daily-a', date: '2026-08-27', protein: 170 })
  data.dailyEntries = upsertDailyEntry(data.dailyEntries, { id: 'daily-a', date: '2026-08-27', protein: 195 })
  assert.deepEqual(data.dailyEntries, [{ id: 'daily-a', date: '2026-08-27', protein: 195 }])
})

test('empty workout cannot finish normally but can be saved after explicit confirmation', () => {
  const workout = createWorkoutFromTemplate(DEFAULT_TEMPLATES[0], INITIAL_MOBILE_DATA, '2026-09-06')
  assert.equal(finalizeWorkout(workout), undefined)
  const explicitlySaved = finalizeWorkout(workout, true)
  assert.ok(explicitlySaved)
  assert.equal(explicitlySaved.exercises.every((exercise) => exercise.sets.length === 0), true)
})

test('finishing a workout keeps only completed sets without empty confirmation', () => {
  const workout = createWorkoutFromTemplate(DEFAULT_TEMPLATES[0], INITIAL_MOBILE_DATA, '2026-09-06')
  const firstExercise = workout.exercises[0]
  const completed = upsertWorkoutSet(workout, firstExercise.id, firstExercise.sets[0].id, { weight: 80, reps: 8 })
  const finalized = finalizeWorkout(completed)
  assert.ok(finalized)
  assert.equal(finalized.exercises[0].sets.length, 1)
  assert.equal(finalized.exercises.slice(1).every((exercise) => exercise.sets.length === 0), true)
})

test('opening workout navigation without an active session only returns a preview', () => {
  const data: AppData = structuredClone(INITIAL_MOBILE_DATA)
  const before = structuredClone(data)
  const destination = workoutDestination(data, '2026-09-06')
  assert.equal(destination.kind, 'preview')
  assert.equal(destination.kind === 'preview' ? destination.template?.id : undefined, DEFAULT_TEMPLATES[0].id)
  assert.deepEqual(data, before)
  assert.equal(data.workouts.length, 0)
})

test('explicit start creates exactly one workout after preview', () => {
  const data: AppData = structuredClone(INITIAL_MOBILE_DATA)
  const destination = workoutDestination(data, '2026-09-06')
  assert.equal(destination.kind, 'preview')
  if (destination.kind !== 'preview' || !destination.template) throw new Error('expected preview template')
  const workout = createWorkoutFromTemplate(destination.template, data, '2026-09-06')
  data.workouts = [...data.workouts, workout]
  assert.equal(data.workouts.length, 1)
  assert.equal(workoutDestination(data, '2026-09-06').kind, 'active')
})

test('mobile journal preserves decimal typing until submit and normalizes comma or dot', () => {
  const commaDraft = journalNumericDraft()
  commaDraft.weight = '79,'
  assert.equal(commaDraft.weight, '79,')
  commaDraft.weight = '79,1'
  const commaEntry = applyJournalNumericDraft({ id: 'daily-comma', date: '2026-09-06' }, commaDraft)
  assert.equal(commaEntry.weight, 79.1)

  const dotDraft = journalNumericDraft()
  dotDraft.weight = '79.1'
  const dotEntry = applyJournalNumericDraft({ id: 'daily-dot', date: '2026-09-07' }, dotDraft)
  assert.equal(dotEntry.weight, 79.1)
  assert.equal(JSON.parse(JSON.stringify(dotEntry)).weight, 79.1)
  assert.equal(journalNumericDraft(JSON.parse(JSON.stringify(dotEntry))).weight, '79.1')
})

test('mobile journal rejects malformed decimals and non-integer integer fields', () => {
  const malformed = journalNumericDraft()
  malformed.weight = '79,1,2'
  assert.throws(() => applyJournalNumericDraft({ id: 'daily-invalid', date: '2026-09-06' }, malformed))

  const fractionalSteps = journalNumericDraft()
  fractionalSteps.steps = '1000,5'
  assert.throws(() => applyJournalNumericDraft({ id: 'daily-invalid-steps', date: '2026-09-06' }, fractionalSteps))
})
