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

const workout = (id: string, date: string, gymLocation: string, item: WorkoutExercise, templateCode: Workout['templateCode'] = 'A'): Workout => ({
  id,
  date,
  gymLocation,
  templateId: 'push',
  templateCode,
  templateName: templateCode === 'D' ? 'GRECKA GÓRA' : 'PUSH',
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

test('A → D → A selects the chronologically latest shared exercise session', () => {
  const reference = exercise('cable-crunch', 55, 10, true)
  const rows = [
    workout('session-a', '2026-08-01', 'Gym A', exercise('cable-crunch', 50, 10, true), 'A'),
    workout('session-d', '2026-08-08', 'Gym A', exercise('cable-crunch', 52.5, 10, true), 'D'),
  ]
  const result = previousExerciseOccurrence(rows, reference, '2026-08-15', 'Gym A')
  assert.equal(result.latest?.workout.id, 'session-d')
  assert.equal(result.comparable?.workout.id, 'session-d')
})

test('same machine in another gym is latest but never directly comparable', () => {
  const reference = exercise('machine-row', 70, 8, true)
  const rows = [workout('other-gym', '2026-08-08', 'Gym B', exercise('machine-row', 75, 8, true))]
  const result = previousExerciseOccurrence(rows, reference, '2026-08-10', 'Gym A')
  assert.equal(result.latest?.workout.id, 'other-gym')
  assert.equal(result.comparable, undefined)
})

test('custom exercise remains selectable by its stable exerciseId', () => {
  const reference = exercise('custom-seal-row', 60, 8)
  const rows = [workout('custom-session', '2026-08-08', 'Gym A', exercise('custom-seal-row', 57.5, 9))]
  assert.equal(previousExerciseOccurrence(rows, reference, '2026-08-10', 'Gym A').comparable?.workout.id, 'custom-session')
})

test('cable row and machine row never share history', () => {
  const rows = [workout('machine-session', '2026-08-08', 'Gym A', exercise('machine-row', 100, 9, true))]
  assert.equal(previousExerciseOccurrence(rows, exercise('chest-supported-row', 80, 8, true), '2026-08-10', 'Gym A').latest, undefined)
})

test('machine lateral raise and dumbbell lateral raise never share history', () => {
  const rows = [workout('dumbbell-session', '2026-08-08', 'Gym A', exercise('dumbbell-lateral-raise', 12, 12))]
  assert.equal(previousExerciseOccurrence(rows, exercise('lateral-raise-machine', 30, 12, true), '2026-08-10', 'Gym A').latest, undefined)
})
