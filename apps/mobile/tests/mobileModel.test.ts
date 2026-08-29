import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_TEMPLATES, upsertDailyEntry, type AppData } from '@greekgod/core'
import { appendWorkoutSet, createWorkoutFromTemplate, nextTemplate, upsertWorkoutSet } from '../src/domain/mobileModel.ts'
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
