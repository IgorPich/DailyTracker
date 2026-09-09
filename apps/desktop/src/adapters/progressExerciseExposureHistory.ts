import {
  exerciseExposureHistory,
  type ExerciseExposureHistoryResult,
} from '@greekgod/analytics'
import { getBestSet, type AppData, type WorkoutSet } from '@greekgod/core'

export interface ProgressExerciseExposureReference {
  workoutExerciseId: string
  displayNameSnapshot: string
  prescriptionSnapshot?: string
  workingSets: WorkoutSet[]
}

export interface ProgressExerciseExposure {
  exerciseId: string
  workoutId: string
  occurredOn: string
  gymContext?: string
  templateCode: string
  templateName: string
  references: ProgressExerciseExposureReference[]
  workingSets: WorkoutSet[]
  bestSet: WorkoutSet
}

export interface ProgressExerciseExposureHistory {
  identityStatus: ExerciseExposureHistoryResult['status']
  excludedIdentityReferences: number
  occurrences: ProgressExerciseExposure[]
}

const toWorkoutSet = (set: {
  setId: string
  weight?: number
  reps?: number
  rir?: number
}): WorkoutSet => ({
  id: set.setId,
  ...(set.weight === undefined ? {} : { weight: set.weight }),
  ...(set.reps === undefined ? {} : { reps: set.reps }),
  ...(set.rir === undefined ? {} : { rir: set.rir }),
})

export const progressExerciseExposureHistory = (
  snapshot: Pick<AppData, 'exerciseLibrary' | 'workouts'>,
  exerciseId: string,
  asOf: string,
): ProgressExerciseExposureHistory => {
  const result = exerciseExposureHistory({
    snapshot,
    exerciseId,
    asOf,
    limit: Math.max(1, snapshot.workouts.length),
  })
  const occurrences = result.exposures.flatMap((exposure) => {
    const workingSets = exposure.workingSets.map(toWorkoutSet)
    const bestSet = getBestSet({
      id: exposure.workoutExerciseId,
      exerciseId: exposure.exerciseId,
      name: exposure.displayNameSnapshot,
      prescription: exposure.prescriptionSnapshot,
      sets: workingSets,
    })
    if (!bestSet) return []
    return [{
      exerciseId: exposure.exerciseId,
      workoutId: exposure.workoutId,
      occurredOn: exposure.occurredOn,
      ...(exposure.gymContext === undefined ? {} : { gymContext: exposure.gymContext }),
      templateCode: exposure.templateCode,
      templateName: exposure.templateName,
      references: exposure.references.map((reference) => ({
        workoutExerciseId: reference.workoutExerciseId,
        displayNameSnapshot: reference.displayNameSnapshot,
        ...(reference.prescriptionSnapshot === undefined ? {} : { prescriptionSnapshot: reference.prescriptionSnapshot }),
        workingSets: reference.workingSets.map(toWorkoutSet),
      })),
      workingSets,
      bestSet,
    }]
  }).reverse()

  return {
    identityStatus: result.status,
    excludedIdentityReferences: result.dataQuality.excludedReferenceCount,
    occurrences,
  }
}
