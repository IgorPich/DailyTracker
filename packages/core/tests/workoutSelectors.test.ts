import assert from 'node:assert/strict'
import test from 'node:test'
import type { Workout, WorkoutExercise } from '../src/types.ts'
import { previousExerciseOccurrence } from '../src/workoutData.ts'
import { compareExercises } from '../src/workoutProgress.ts'

const exercise = (id: string, weight: number, reps: number, equipmentSensitive = false): WorkoutExercise => ({
  id: `${id}-occurrence`,
  exerciseId: id,
  name: id,
  prescription: '3 × 6–10',
  equipmentSensitive,
  sets: [{ id: `${id}-${weight}-${reps}`, weight, reps }],
})

const workout = (id: string, date: string, gymLocation: string, item: WorkoutExercise): Workout => ({
  id,
  date,
  gymLocation,
  templateId: 'push',
  templateCode: 'A',
  templateName: 'PUSH',
  exercises: [item],
})

test('free weight previous result crosses gyms and keeps exact exercise identity', () => {
  const bench = exercise('bench-press', 90, 6)
  const rows = [
    workout('older', '2026-08-01', 'Gym A', bench),
    workout('latest', '2026-08-08', 'Gym B', exercise('bench-press', 90, 7)),
    workout('different', '2026-08-09', 'Gym B', exercise('incline-smith', 100, 8, true)),
  ]
  const result = previousExerciseOccurrence(rows, bench, '2026-08-10', 'Gym A')
  assert.equal(result.latest?.workout.id, 'latest')
  assert.equal(result.comparable?.workout.id, 'latest')
})

test('equipment-sensitive previous result is restricted to the same gym', () => {
  const machine = exercise('cable-fly', 30, 10, true)
  const rows = [
    workout('same-gym', '2026-08-01', 'Gym A', machine),
    workout('other-gym', '2026-08-08', 'Gym B', exercise('cable-fly', 40, 10, true)),
  ]
  const result = previousExerciseOccurrence(rows, machine, '2026-08-10', 'Gym A')
  assert.equal(result.latest?.workout.id, 'other-gym')
  assert.equal(result.comparable?.workout.id, 'same-gym')
})

test('shared progress logic marks a real improvement positive', () => {
  const result = compareExercises(
    exercise('bench-press', 90, 7),
    exercise('bench-press', 90, 6),
    'Gym A',
    'Gym B',
  )
  assert.deepEqual(result, { label: '+1 powt.', positive: true })
})
