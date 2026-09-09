import {
  classifyExerciseComparability,
  classifyExerciseIdentity,
  UNRESOLVED_EXERCISE_IDENTITY,
  type WorkoutExercise,
} from '@greekgod/core'
import type {
  ExerciseExposure,
  ExerciseExposureDataQuality,
  ExerciseExposureHistoryResult,
  ExerciseExposureIdentityIssue,
  ExerciseExposureReference,
  ExerciseExposureWorkingSet,
} from '../../domain/exercise/exerciseExposure.ts'
import type { TrackingExerciseHistorySnapshot } from '../../ports/trackingExerciseHistorySnapshot.ts'

const DEFAULT_EXPOSURE_LIMIT = 5

export interface ExerciseExposureHistoryQuery {
  snapshot: TrackingExerciseHistorySnapshot
  exerciseId: string
  asOf: string
  limit?: number
  comparisonGymContext?: string
}

const hasWorkingSetData = (exercise: WorkoutExercise) => exercise.sets.some((set) => (
  set.weight !== undefined || set.reps !== undefined
))

const workingSetsFor = (
  exercise: WorkoutExercise,
  exerciseOrder: number,
): ExerciseExposureWorkingSet[] => exercise.sets
  .map((set, setOrder) => ({ set, setOrder }))
  .filter(({ set }) => set.weight !== undefined || set.reps !== undefined)
  .map(({ set, setOrder }) => ({
    setId: set.id,
    workoutExerciseId: exercise.id,
    exerciseOrder,
    setOrder,
    ...(set.weight === undefined ? {} : { weight: set.weight }),
    ...(set.reps === undefined ? {} : { reps: set.reps }),
    ...(set.rir === undefined ? {} : { rir: set.rir }),
  }))

const identityIssue = (
  workoutId: string,
  exercise: WorkoutExercise,
  reason: ExerciseExposureIdentityIssue['reason'],
  exerciseId?: string,
): ExerciseExposureIdentityIssue => ({
  classification: UNRESOLVED_EXERCISE_IDENTITY,
  reason,
  workoutId,
  workoutExerciseId: exercise.id,
  ...(exerciseId === undefined ? {} : { exerciseId }),
})

const dataQuality = (issues: ExerciseExposureIdentityIssue[]): ExerciseExposureDataQuality => ({
  excludedReferenceCount: issues.length,
  issues,
})

const requestedLimit = (limit?: number) => {
  const value = limit === undefined ? DEFAULT_EXPOSURE_LIMIT : limit
  if (!Number.isInteger(value) || value <= 0) throw new RangeError('Exposure limit must be a positive integer.')
  return value
}

export const exerciseExposureHistory = (
  query: ExerciseExposureHistoryQuery,
): ExerciseExposureHistoryResult => {
  const limit = requestedLimit(query.limit)
  const targetIdentity = classifyExerciseIdentity(query.snapshot.exerciseLibrary, { exerciseId: query.exerciseId })
  if (targetIdentity.classification === UNRESOLVED_EXERCISE_IDENTITY) {
    return {
      status: UNRESOLVED_EXERCISE_IDENTITY,
      exerciseId: query.exerciseId,
      reason: targetIdentity.reason,
      exposures: [],
      dataQuality: dataQuality([]),
    }
  }

  const definition = query.snapshot.exerciseLibrary.find((item) => item.id === targetIdentity.exerciseId)!
  const issues: ExerciseExposureIdentityIssue[] = []
  const exposures: ExerciseExposure[] = []
  const eligibleWorkouts = query.snapshot.workouts
    .map((workout, sourceOrder) => ({ workout, sourceOrder }))
    .filter(({ workout }) => workout.date <= query.asOf)
    .sort((left, right) => right.workout.date.localeCompare(left.workout.date) || left.sourceOrder - right.sourceOrder)

  for (const { workout } of eligibleWorkouts) {
    const matchingReferences: Array<{ exercise: WorkoutExercise; exerciseOrder: number }> = []
    workout.exercises.forEach((exercise, exerciseOrder) => {
      const resolution = classifyExerciseIdentity(query.snapshot.exerciseLibrary, exercise)
      if (resolution.classification === UNRESOLVED_EXERCISE_IDENTITY) {
        issues.push(identityIssue(workout.id, exercise, resolution.reason, resolution.exerciseId))
        return
      }
      if (
        resolution.exerciseId === targetIdentity.exerciseId
        && !exercise.skipped
        && hasWorkingSetData(exercise)
      ) {
        matchingReferences.push({ exercise, exerciseOrder })
      }
    })
    if (!matchingReferences.length) continue
    if (exposures.length >= limit) continue

    const references: ExerciseExposureReference[] = matchingReferences.map(({ exercise, exerciseOrder }) => ({
      workoutExerciseId: exercise.id,
      displayNameSnapshot: exercise.name,
      ...(exercise.prescription === undefined ? {} : { prescriptionSnapshot: exercise.prescription }),
      workingSets: workingSetsFor(exercise, exerciseOrder),
    }))
    const workingSets = references.flatMap((reference) => reference.workingSets)
    const first = references[0]
    const equipmentSensitive = definition.equipmentSensitive
      || matchingReferences.some(({ exercise }) => exercise.equipmentSensitive === true)
    exposures.push({
      exerciseId: targetIdentity.exerciseId,
      workoutId: workout.id,
      workoutExerciseId: first.workoutExerciseId,
      occurredOn: workout.date,
      ...(workout.gymLocation === undefined ? {} : { gymContext: workout.gymLocation }),
      templateId: workout.templateId,
      templateCode: workout.templateCode,
      templateName: workout.templateName,
      displayNameSnapshot: first.displayNameSnapshot,
      ...(first.prescriptionSnapshot === undefined ? {} : { prescriptionSnapshot: first.prescriptionSnapshot }),
      workingSets,
      references,
      comparability: classifyExerciseComparability(
        equipmentSensitive,
        query.comparisonGymContext,
        workout.gymLocation,
      ),
      evidence: {
        workoutId: workout.id,
        workoutExerciseIds: references.map((reference) => reference.workoutExerciseId),
        setIds: workingSets.map((set) => set.setId),
      },
    })
  }

  return {
    status: 'READY',
    exerciseId: targetIdentity.exerciseId,
    exposures,
    dataQuality: dataQuality(issues),
  }
}
