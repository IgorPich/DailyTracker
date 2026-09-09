import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExerciseDefinition, Workout, WorkoutExercise, WorkoutSet } from '@greekgod/core'
import { exerciseExposureHistory, type TrackingExerciseHistorySnapshot } from '../src/index.ts'

const definition = (
  id: string,
  equipmentSensitive = false,
  name = `Synthetic ${id}`,
  aliases?: string[],
): ExerciseDefinition => ({ id, name, equipmentSensitive, ...(aliases ? { aliases } : {}) })

const sets = (...values: Array<[string, number?, number?, number?]>): WorkoutSet[] => values.map(([id, weight, reps, rir]) => ({
  id,
  ...(weight === undefined ? {} : { weight }),
  ...(reps === undefined ? {} : { reps }),
  ...(rir === undefined ? {} : { rir }),
}))

const exercise = (
  workoutExerciseId: string,
  exerciseId: string | undefined,
  name: string,
  workingSets: WorkoutSet[] = sets([`${workoutExerciseId}-set`, 10, 10]),
  options: Partial<WorkoutExercise> = {},
): WorkoutExercise => ({
  id: workoutExerciseId,
  ...(exerciseId === undefined ? {} : { exerciseId }),
  name,
  prescription: '3 × 8–12',
  sets: workingSets,
  ...options,
})

const workout = (
  id: string,
  date: string,
  exercises: WorkoutExercise[],
  gymLocation?: string,
): Workout => ({
  id,
  date,
  templateId: 'synthetic-template',
  templateCode: 'A',
  templateName: 'Synthetic template',
  exercises,
  ...(gymLocation === undefined ? {} : { gymLocation }),
})

const snapshot = (
  exerciseLibrary: ExerciseDefinition[],
  workouts: Workout[],
): TrackingExerciseHistorySnapshot => ({ exerciseLibrary, workouts })

test('selects history only for the exact resolved exerciseId', () => {
  const target = 'synthetic-exact-id'
  const data = snapshot(
    [definition(target), definition('synthetic-other-id')],
    [workout('workout-exact', '2026-01-01', [
      exercise('reference-exact', target, 'Same display'),
      exercise('reference-other', 'synthetic-other-id', 'Same display'),
    ])],
  )
  const before = structuredClone(data)
  const result = exerciseExposureHistory({
    snapshot: data,
    exerciseId: target,
    asOf: '2026-01-02',
  })

  assert.equal(result.status, 'READY')
  assert.deepEqual(result.exposures.map((item) => item.workoutExerciseId), ['reference-exact'])
  assert.deepEqual(data, before)
})

test('same and similar names with different IDs are excluded', () => {
  const target = 'synthetic-name-a'
  const result = exerciseExposureHistory({
    snapshot: snapshot(
      [definition(target, false, 'Synthetic Row'), definition('synthetic-name-b', false, ' synthetic  row ')],
      [workout('workout-names', '2026-01-01', [
        exercise('reference-name-a', target, 'Synthetic Row'),
        exercise('reference-name-b', 'synthetic-name-b', 'synthetic row'),
      ])],
    ),
    exerciseId: target,
    asOf: '2026-01-02',
  })

  assert.equal(result.exposures.length, 1)
  assert.deepEqual(result.exposures[0].evidence.workoutExerciseIds, ['reference-name-a'])
})

test('alias collisions never merge exposure history', () => {
  const target = 'synthetic-alias-a'
  const collision = 'Shared synthetic alias'
  const result = exerciseExposureHistory({
    snapshot: snapshot(
      [definition(target, false, 'Synthetic A', [collision]), definition('synthetic-alias-b', false, 'Synthetic B', [collision])],
      [workout('workout-aliases', '2026-01-01', [
        exercise('reference-alias-a', target, collision),
        exercise('reference-alias-b', 'synthetic-alias-b', collision),
      ])],
    ),
    exerciseId: target,
    asOf: '2026-01-02',
  })

  assert.deepEqual(result.exposures[0].evidence.workoutExerciseIds, ['reference-alias-a'])
})

test('replacement in the same template slot keeps histories separate', () => {
  const originalId = 'synthetic-original'
  const replacementId = 'synthetic-replacement'
  const data = snapshot(
    [definition(originalId), definition(replacementId)],
    [
      workout('workout-original', '2026-01-01', [exercise('stable-slot', originalId, 'Original')]),
      workout('workout-replacement', '2026-01-02', [exercise('stable-slot', replacementId, 'Replacement')]),
    ],
  )

  const original = exerciseExposureHistory({ snapshot: data, exerciseId: originalId, asOf: '2026-01-03' })
  const replacement = exerciseExposureHistory({ snapshot: data, exerciseId: replacementId, asOf: '2026-01-03' })
  assert.deepEqual(original.exposures.map((item) => item.workoutId), ['workout-original'])
  assert.deepEqual(replacement.exposures.map((item) => item.workoutId), ['workout-replacement'])
})

test('equipment-sensitive exposure at the same gym is comparable', () => {
  const target = 'synthetic-sensitive-same'
  const result = exerciseExposureHistory({
    snapshot: snapshot([definition(target, true)], [
      workout('workout-same-gym', '2026-01-01', [exercise('reference-same-gym', target, 'Sensitive')], 'Gym One'),
    ]),
    exerciseId: target,
    asOf: '2026-01-02',
    comparisonGymContext: ' gym one ',
  })

  assert.deepEqual(result.exposures[0].comparability, { status: 'COMPARABLE', reason: 'SAME_GYM' })
})

test('equipment-sensitive exposure at a different gym is not comparable', () => {
  const target = 'synthetic-sensitive-different'
  const result = exerciseExposureHistory({
    snapshot: snapshot([definition(target, true)], [
      workout('workout-other-gym', '2026-01-01', [exercise('reference-other-gym', target, 'Sensitive')], 'Gym Two'),
    ]),
    exerciseId: target,
    asOf: '2026-01-02',
    comparisonGymContext: 'Gym One',
  })

  assert.deepEqual(result.exposures[0].comparability, { status: 'NOT_COMPARABLE', reason: 'DIFFERENT_GYM' })
})

test('free-weight exposure remains comparable across gyms', () => {
  const target = 'synthetic-free-weight'
  const result = exerciseExposureHistory({
    snapshot: snapshot([definition(target)], [
      workout('workout-free-weight', '2026-01-01', [exercise('reference-free-weight', target, 'Free weight')], 'Gym Two'),
    ]),
    exerciseId: target,
    asOf: '2026-01-02',
    comparisonGymContext: 'Gym One',
  })

  assert.deepEqual(result.exposures[0].comparability, { status: 'COMPARABLE', reason: 'EQUIPMENT_INDEPENDENT' })
})

test('unresolved references are excluded and reported as read-only data quality', () => {
  const target = 'synthetic-resolved-target'
  const result = exerciseExposureHistory({
    snapshot: snapshot([definition(target)], [workout('workout-quality', '2026-01-01', [
      exercise('reference-resolved', target, 'Resolved'),
      exercise('reference-missing', undefined, 'Same name as resolved'),
      exercise('reference-unknown', 'synthetic-unknown-id', 'Resolved'),
    ])]),
    exerciseId: target,
    asOf: '2026-01-02',
  })

  assert.equal(result.exposures.length, 1)
  assert.deepEqual(result.dataQuality.issues.map((issue) => [issue.workoutExerciseId, issue.reason]), [
    ['reference-missing', 'MISSING_EXERCISE_ID'],
    ['reference-unknown', 'UNKNOWN_EXERCISE_DEFINITION'],
  ])
})

test('an arbitrary exercise UUID works without any source registration', () => {
  const newExerciseId = crypto.randomUUID()
  const result = exerciseExposureHistory({
    snapshot: snapshot([definition(newExerciseId)], [
      workout('workout-arbitrary', '2026-01-01', [exercise('reference-arbitrary', newExerciseId, 'Runtime-created exercise')]),
    ]),
    exerciseId: newExerciseId,
    asOf: '2026-01-02',
  })

  assert.equal(result.exerciseId, newExerciseId)
  assert.equal(result.exposures[0].exerciseId, newExerciseId)
})

test('preserves set order, reference evidence and historical prescription snapshots', () => {
  const target = 'synthetic-snapshot'
  const result = exerciseExposureHistory({
    snapshot: snapshot([definition(target)], [workout('workout-snapshot', '2026-01-01', [
      exercise('reference-first', target, 'Historical first name', sets(
        ['set-second-by-name', 20, 8, 2],
        ['set-first-by-name', 22.5, 7, 1],
      ), { prescription: '2 × 7–9' }),
      exercise('reference-second', target, 'Historical second name', sets(['set-third', 15, 12])),
    ])]),
    exerciseId: target,
    asOf: '2026-01-02',
  })

  const exposure = result.exposures[0]
  assert.equal(exposure.displayNameSnapshot, 'Historical first name')
  assert.equal(exposure.prescriptionSnapshot, '2 × 7–9')
  assert.deepEqual(exposure.workingSets.map((set) => set.setId), ['set-second-by-name', 'set-first-by-name', 'set-third'])
  assert.deepEqual(exposure.evidence.workoutExerciseIds, ['reference-first', 'reference-second'])
  assert.deepEqual(exposure.evidence.setIds, ['set-second-by-name', 'set-first-by-name', 'set-third'])
})

test('limit returns latest chronological exposures and default limit is five', () => {
  const target = 'synthetic-limit'
  const workouts = Array.from({ length: 7 }, (_, index) => workout(
    `workout-${index + 1}`,
    `2026-01-0${index + 1}`,
    [exercise(`reference-${index + 1}`, target, 'Limited')],
  ))
  const data = snapshot([definition(target)], [workouts[2], workouts[0], workouts[6], workouts[1], workouts[5], workouts[3], workouts[4]])

  const limited = exerciseExposureHistory({ snapshot: data, exerciseId: target, asOf: '2026-01-06', limit: 2 })
  const defaulted = exerciseExposureHistory({ snapshot: data, exerciseId: target, asOf: '2026-01-07' })
  assert.deepEqual(limited.exposures.map((item) => item.occurredOn), ['2026-01-06', '2026-01-05'])
  assert.deepEqual(defaulted.exposures.map((item) => item.occurredOn), [
    '2026-01-07',
    '2026-01-06',
    '2026-01-05',
    '2026-01-04',
    '2026-01-03',
  ])
})

test('unresolved target identity returns an explicit result', () => {
  const result = exerciseExposureHistory({
    snapshot: snapshot([], []),
    exerciseId: 'synthetic-missing-target',
    asOf: '2026-01-01',
  })

  assert.deepEqual(result, {
    status: 'UNRESOLVED_EXERCISE_IDENTITY',
    exerciseId: 'synthetic-missing-target',
    reason: 'UNKNOWN_EXERCISE_DEFINITION',
    exposures: [],
    dataQuality: { excludedReferenceCount: 0, issues: [] },
  })
})
