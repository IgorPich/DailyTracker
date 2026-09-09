import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExerciseDefinition, Workout, WorkoutSet } from '@greekgod/core'
import {
  exerciseExposureHistory,
  exerciseProgressClassification,
  type ExerciseProgressResult,
  type TrackingExerciseHistorySnapshot,
} from '../src/index.ts'

interface ExposureFixture {
  workoutId: string
  date: string
  sets: WorkoutSet[]
  gym?: string
  exerciseId?: string
  workoutExerciseId?: string
  prescription?: string
}

const set = (id: string, weight: number, reps: number): WorkoutSet => ({ id, weight, reps })

const snapshotFor = (
  targetExerciseId: string,
  exposures: ExposureFixture[],
  equipmentSensitive = false,
  additionalDefinitions: ExerciseDefinition[] = [],
): TrackingExerciseHistorySnapshot => ({
  exerciseLibrary: [
    { id: targetExerciseId, name: 'Runtime exercise', equipmentSensitive },
    ...additionalDefinitions,
  ],
  workouts: exposures.map((fixture): Workout => ({
    id: fixture.workoutId,
    date: fixture.date,
    templateId: 'runtime-template',
    templateCode: 'A',
    templateName: 'Runtime template',
    ...(fixture.gym === undefined ? {} : { gymLocation: fixture.gym }),
    exercises: [{
      id: fixture.workoutExerciseId ?? `${fixture.workoutId}-reference`,
      exerciseId: fixture.exerciseId ?? targetExerciseId,
      name: 'Historical runtime name',
      prescription: fixture.prescription ?? '3 × 6–10',
      sets: fixture.sets,
      equipmentSensitive,
    }],
  })),
})

const classify = (
  exerciseId: string,
  exposures: ExposureFixture[],
  equipmentSensitive = false,
  additionalDefinitions: ExerciseDefinition[] = [],
): ExerciseProgressResult => exerciseProgressClassification({
  history: exerciseExposureHistory({
    snapshot: snapshotFor(exerciseId, exposures, equipmentSensitive, additionalDefinitions),
    exerciseId,
    asOf: '2026-12-31',
    limit: 20,
  }),
})

test('same load and more reps across complete working sets is progress', () => {
  const result = classify('runtime-more-reps', [
    { workoutId: 'current', date: '2026-02-02', sets: [set('c1', 80, 9), set('c2', 80, 8)] },
    { workoutId: 'previous', date: '2026-02-01', sets: [set('p1', 80, 8), set('p2', 80, 8)] },
  ])

  assert.equal(result.status, 'PROGRESS')
  assert.ok(result.reasonCodes.includes('MORE_REPS_SAME_LOAD'))
  assert.deepEqual(result.evidence.setComparisons.map((item) => item.outcome), ['BETTER', 'EQUIVALENT'])
})

test('same load and fewer reps is regression', () => {
  const result = classify('runtime-fewer-reps', [
    { workoutId: 'current', date: '2026-02-02', sets: [set('current-set', 80, 7)] },
    { workoutId: 'previous', date: '2026-02-01', sets: [set('previous-set', 80, 8)] },
  ])

  assert.equal(result.status, 'REGRESSION')
  assert.deepEqual(result.reasonCodes, ['LOWER_REPS_SAME_LOAD'])
})

test('equivalent complete work-set performance is flat', () => {
  const result = classify('runtime-equivalent', [
    { workoutId: 'current', date: '2026-02-02', sets: [set('c1', 50, 10), set('c2', 50, 9)] },
    { workoutId: 'previous', date: '2026-02-01', sets: [set('p1', 50, 10), set('p2', 50, 9)] },
  ])

  assert.equal(result.status, 'FLAT')
  assert.deepEqual(result.reasonCodes, ['SAME_LOAD_AND_REPS'])
})

test('load increase with maintained performance is progress', () => {
  const result = classify('runtime-load-increase', [
    { workoutId: 'current', date: '2026-02-02', sets: [set('current-set', 82.5, 8)] },
    { workoutId: 'previous', date: '2026-02-01', sets: [set('previous-set', 80, 8)] },
  ])

  assert.equal(result.status, 'PROGRESS')
  assert.deepEqual(result.reasonCodes, ['LOAD_INCREASE_WITH_REPS_MAINTAINED'])
})

test('heavier load below the accepted rep floor never becomes progress', () => {
  const result = classify('runtime-load-warning', [
    { workoutId: 'current', date: '2026-02-02', sets: [set('current-set', 85, 5)] },
    { workoutId: 'previous', date: '2026-02-01', sets: [set('previous-set', 80, 8)] },
  ])

  assert.equal(result.status, 'FLAT')
  assert.ok(result.reasonCodes.includes('LOAD_INCREASE_BELOW_REP_FLOOR'))
  assert.ok(result.reasonCodes.includes('PERFORMANCE_TRADE_OFF'))
})

test('opposing results across multiple sets are reported as mixed and flat', () => {
  const result = classify('runtime-mixed-sets', [
    { workoutId: 'current', date: '2026-02-02', sets: [set('c1', 70, 9), set('c2', 70, 7)] },
    { workoutId: 'previous', date: '2026-02-01', sets: [set('p1', 70, 8), set('p2', 70, 8)] },
  ])

  assert.equal(result.status, 'FLAT')
  assert.ok(result.reasonCodes.includes('MIXED_SET_PERFORMANCE'))
  assert.deepEqual(result.evidence.setComparisons.map((item) => item.outcome), ['BETTER', 'WORSE'])
})

test('changed set count blocks a directional verdict and preserves unpaired evidence', () => {
  const result = classify('runtime-set-count', [
    { workoutId: 'current', date: '2026-02-02', sets: [set('c1', 70, 9), set('c2', 70, 9)] },
    { workoutId: 'previous', date: '2026-02-01', sets: [set('p1', 70, 8)] },
  ])

  assert.equal(result.status, 'FLAT')
  assert.ok(result.reasonCodes.includes('SET_COUNT_CHANGED'))
  assert.deepEqual(result.evidence.unpairedCurrentSetIds, ['c2'])
})

test('equipment-sensitive exposures at different gyms are not comparable', () => {
  const result = classify('runtime-sensitive', [
    { workoutId: 'current', date: '2026-02-02', gym: 'Gym B', sets: [set('current-set', 80, 9)] },
    { workoutId: 'previous', date: '2026-02-01', gym: 'Gym A', sets: [set('previous-set', 80, 8)] },
  ], true)

  assert.equal(result.status, 'NOT_COMPARABLE')
  assert.deepEqual(result.reasonCodes, ['DIFFERENT_GYM_EQUIPMENT', 'NO_PREVIOUS_COMPARABLE_EXPOSURE'])
  assert.equal(result.evidence.setComparisons.length, 0)
})

test('equipment-sensitive classification uses the latest previous comparable gym exposure', () => {
  const result = classify('runtime-latest-comparable', [
    { workoutId: 'current', date: '2026-02-03', gym: 'Gym A', sets: [set('current-set', 80, 9)] },
    { workoutId: 'latest-other-gym', date: '2026-02-02', gym: 'Gym B', sets: [set('other-set', 90, 10)] },
    { workoutId: 'older-same-gym', date: '2026-02-01', gym: 'Gym A', sets: [set('same-set', 80, 8)] },
  ], true)

  assert.equal(result.status, 'PROGRESS')
  assert.equal(result.comparisonExposure?.workoutId, 'older-same-gym')
  assert.deepEqual(result.evidence.consideredPreviousWorkoutIds, ['latest-other-gym', 'older-same-gym'])
})

test('equipment-independent exercise remains comparable across gyms', () => {
  const result = classify('runtime-free-weight', [
    { workoutId: 'current', date: '2026-02-02', gym: 'Gym B', sets: [set('current-set', 80, 9)] },
    { workoutId: 'previous', date: '2026-02-01', gym: 'Gym A', sets: [set('previous-set', 80, 8)] },
  ])

  assert.equal(result.status, 'PROGRESS')
})

test('missing previous exposure returns insufficient data', () => {
  const result = classify('runtime-first-exposure', [
    { workoutId: 'current', date: '2026-02-02', sets: [set('current-set', 80, 8)] },
  ])

  assert.equal(result.status, 'INSUFFICIENT_DATA')
  assert.deepEqual(result.reasonCodes, ['NO_PREVIOUS_EXPOSURE'])
})

test('unresolved target identity cannot produce false progression', () => {
  const history = exerciseExposureHistory({
    snapshot: { exerciseLibrary: [], workouts: [] },
    exerciseId: 'runtime-unresolved',
    asOf: '2026-02-02',
  })
  const result = exerciseProgressClassification({ history })

  assert.equal(result.status, 'INSUFFICIENT_DATA')
  assert.deepEqual(result.reasonCodes, ['UNRESOLVED_EXERCISE_IDENTITY'])
  assert.equal(result.currentExposure, undefined)
})

test('replacement in the same template slot never enters another exercise classification', () => {
  const originalId = 'runtime-original-id'
  const replacementId = 'runtime-replacement-id'
  const result = classify(replacementId, [
    { workoutId: 'replacement-current', date: '2026-02-03', workoutExerciseId: 'stable-slot', sets: [set('rc', 40, 9)] },
    { workoutId: 'replacement-previous', date: '2026-02-02', workoutExerciseId: 'stable-slot', sets: [set('rp', 40, 8)] },
    { workoutId: 'original-history', date: '2026-02-01', workoutExerciseId: 'stable-slot', exerciseId: originalId, sets: [set('old', 100, 20)] },
  ], false, [{ id: originalId, name: 'Original runtime exercise', equipmentSensitive: false }])

  assert.equal(result.status, 'PROGRESS')
  assert.equal(result.comparisonExposure?.workoutId, 'replacement-previous')
  assert.ok(!result.evidence.consideredPreviousWorkoutIds.includes('original-history'))
})

test('runtime-generated exercise ID works without source changes', () => {
  const exerciseId = crypto.randomUUID()
  const result = classify(exerciseId, [
    { workoutId: 'current', date: '2026-02-02', sets: [set('current-set', 60, 10)] },
    { workoutId: 'previous', date: '2026-02-01', sets: [set('previous-set', 60, 9)] },
  ])

  assert.equal(result.exerciseId, exerciseId)
  assert.equal(result.status, 'PROGRESS')
})

test('classification is deterministic and does not mutate exposure history', () => {
  const exerciseId = 'runtime-deterministic'
  const history = exerciseExposureHistory({
    snapshot: snapshotFor(exerciseId, [
      { workoutId: 'current', date: '2026-02-02', sets: [set('c1', 60, 10), set('c2', 60, 9)] },
      { workoutId: 'previous', date: '2026-02-01', sets: [set('p1', 60, 9), set('p2', 60, 9)] },
    ]),
    exerciseId,
    asOf: '2026-02-03',
  })
  const before = structuredClone(history)

  assert.deepEqual(
    exerciseProgressClassification({ history }),
    exerciseProgressClassification({ history }),
  )
  assert.deepEqual(history, before)
})
