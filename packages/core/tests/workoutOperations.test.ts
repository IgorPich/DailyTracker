import { deepStrictEqual, equal, notStrictEqual, strictEqual } from 'node:assert/strict'
import test from 'node:test'
import { addWorkout, deleteWorkout, findWorkoutById, updateWorkout } from '../src/workoutOperations.ts'
import {
  workoutExerciseFixture as exercise,
  workoutFixture as workout,
  workoutSetFixture as set,
} from './fixtures/workout.fixture.ts'

test('adds a new workout at the end and preserves existing order', () => {
  const workouts = [workout('workout-a'), workout('workout-b')]
  const incoming = workout('workout-c', { date: '2026-08-25' })

  const result = addWorkout(workouts, incoming)

  deepStrictEqual(result.map((item) => item.id), ['workout-a', 'workout-b', 'workout-c'])
  equal(result.length, workouts.length + 1)
  strictEqual(result.at(-1), incoming)
})

test('preserves the complete workout, exercise and set snapshot when adding', () => {
  const incoming = workout('workout-complete', {
    date: '2026-08-25',
    templateId: 'fixture-template-d',
    templateCode: 'D',
    templateName: 'SYNTHETIC UPPER',
    duration: 91,
    gymLocation: 'Klub Syntetyczny Południe',
    note: '  Workout note remains untouched  ',
  })

  const result = addWorkout([], incoming)

  deepStrictEqual(result[0], incoming)
})

test('updates an existing workout in place without creating a duplicate', () => {
  const workouts = [workout('workout-a'), workout('workout-x'), workout('workout-c')]
  const updated = workout('workout-x', {
    date: '2026-08-25',
    templateId: 'fixture-template-d',
    templateCode: 'D',
    templateName: 'SYNTHETIC UPPER',
    duration: 88,
    gymLocation: 'Klub Syntetyczny Południe',
    note: 'Updated synthetic workout',
  })

  const result = updateWorkout(workouts, updated)

  deepStrictEqual(result.map((item) => item.id), ['workout-a', 'workout-x', 'workout-c'])
  equal(result.length, workouts.length)
  equal(result.filter((item) => item.id === updated.id).length, 1)
  strictEqual(result[1], updated)
})

test('preserves date, type, gym, duration and notes from the updated workout', () => {
  const updated = workout('workout-x', {
    date: '2026-08-26',
    templateId: 'fixture-template-b',
    templateCode: 'B',
    templateName: 'SYNTHETIC PULL',
    duration: 64,
    gymLocation: 'Klub Syntetyczny Zachód',
    note: 'Synthetic top-level note',
  })

  const result = updateWorkout([workout('workout-x')], updated)

  deepStrictEqual(result[0], updated)
})

test('preserves exercise order and set order exactly as supplied', () => {
  const updated = workout('workout-x', {
    exercises: [
      exercise('exercise-second', {
        sets: [set('set-second', 70, 7, 1), set('set-first', 65, 9, 2)],
      }),
      exercise('exercise-first', {
        sets: [set('set-fourth', 40, 12, 0), set('set-third', 35, 15, 1)],
      }),
    ],
  })

  const result = updateWorkout([workout('workout-x')], updated)

  deepStrictEqual(result[0].exercises.map((item) => item.id), ['exercise-second', 'exercise-first'])
  deepStrictEqual(result[0].exercises[0].sets.map((item) => item.id), ['set-second', 'set-first'])
  deepStrictEqual(result[0].exercises[1].sets.map((item) => item.id), ['set-fourth', 'set-third'])
})

test('preserves historical exercise snapshots and every nested field', () => {
  const historicalExercise = exercise('historical-row', {
    exerciseId: 'canonical-row-v1',
    name: 'Historyczna nazwa z literówką',
    prescription: '3 × 8–12',
    skipped: true,
    isCustom: true,
    equipmentSensitive: false,
    note: '  Historical note remains untouched  ',
    sets: [set('historical-set-b', 80, 7, 1), set('historical-set-a', 75, 9, 2)],
  })
  const updated = workout('workout-x', { exercises: [historicalExercise] })

  const result = updateWorkout([workout('workout-x')], updated)

  deepStrictEqual(result[0].exercises, [historicalExercise])
  strictEqual(result[0].exercises[0], historicalExercise)
})

test('does not mutate the input workout list or existing snapshots', () => {
  const workouts = [workout('workout-a'), workout('workout-x'), workout('workout-c')]
  const snapshot = structuredClone(workouts)

  const result = updateWorkout(workouts, workout('workout-x', { duration: 99 }))

  deepStrictEqual(workouts, snapshot)
  notStrictEqual(result, workouts)
  strictEqual(result[0], workouts[0])
  strictEqual(result[2], workouts[2])
})

test('does not append a workout when the updated id is missing', () => {
  const workouts = [workout('workout-a'), workout('workout-b')]

  const result = updateWorkout(workouts, workout('workout-missing'))

  deepStrictEqual(result, workouts)
  notStrictEqual(result, workouts)
})

test('replaces all pre-existing duplicate ids without silently deduplicating history', () => {
  const workouts = [workout('workout-x', { note: 'First duplicate' }), workout('workout-x', { note: 'Second duplicate' })]
  const updated = workout('workout-x', { note: 'Updated duplicate snapshot' })

  const result = updateWorkout(workouts, updated)

  equal(result.length, 2)
  equal(result.filter((item) => item.id === updated.id).length, 2)
  strictEqual(result[0], updated)
  strictEqual(result[1], updated)
})

test('deletes every workout with the exact id and preserves remaining snapshots', () => {
  const duplicateA = workout('duplicate-id', { note: 'First duplicate' })
  const untouched = workout('untouched-id', { note: 'Untouched snapshot' })
  const duplicateB = workout('duplicate-id', { note: 'Second duplicate' })
  const workouts = [duplicateA, untouched, duplicateB]

  const result = deleteWorkout(workouts, 'duplicate-id')

  deepStrictEqual(result, [untouched])
  strictEqual(result[0], untouched)
  deepStrictEqual(workouts, [duplicateA, untouched, duplicateB])
})

test('workout delete returns a new list when the id is missing', () => {
  const workouts = [workout('workout-a')]

  const result = deleteWorkout(workouts, 'missing-id')

  deepStrictEqual(result, workouts)
  notStrictEqual(result, workouts)
})

test('workout lookup returns the first exact id match', () => {
  const first = workout('workout-x', { note: 'First duplicate' })
  const duplicate = workout('workout-x', { note: 'Second duplicate' })

  strictEqual(findWorkoutById([first, duplicate], 'workout-x'), first)
  strictEqual(findWorkoutById([first], 'WORKOUT-X'), undefined)
})
