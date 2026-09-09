import { classifyExerciseComparability } from '@greekgod/core'
import type { ExerciseExposureHistoryResult } from '../../domain/exercise/exerciseExposure.ts'
import { classifyComparableExposureProgress } from '../../domain/exercise/classifyComparableExposureProgress.ts'
import {
  EXERCISE_PROGRESS_ALGORITHM_VERSION,
  type ExerciseProgressEvidence,
  type ExerciseProgressReasonCode,
  type ExerciseProgressResult,
  type NonComparableExposureEvidence,
} from '../../domain/exercise/exerciseProgress.ts'

export interface ExerciseProgressClassificationInput {
  history: ExerciseExposureHistoryResult
}

const emptyEvidence = (): ExerciseProgressEvidence => ({
  consideredPreviousWorkoutIds: [],
  nonComparableExposures: [],
  currentCompleteSetIds: [],
  comparisonCompleteSetIds: [],
  unpairedCurrentSetIds: [],
  unpairedComparisonSetIds: [],
  setComparisons: [],
})

const insufficientResult = (
  history: ExerciseExposureHistoryResult,
  reasonCode: ExerciseProgressReasonCode,
): ExerciseProgressResult => ({
  exerciseId: history.exerciseId,
  status: 'INSUFFICIENT_DATA',
  reasonCodes: [reasonCode],
  evidence: emptyEvidence(),
  algorithmVersion: EXERCISE_PROGRESS_ALGORITHM_VERSION,
})

const reasonForNonComparable = (
  evidence: NonComparableExposureEvidence[],
): ExerciseProgressReasonCode => evidence.some((item) => item.comparability.reason === 'DIFFERENT_GYM')
  ? 'DIFFERENT_GYM_EQUIPMENT'
  : 'MISSING_GYM_CONTEXT'

export const exerciseProgressClassification = (
  input: ExerciseProgressClassificationInput,
): ExerciseProgressResult => {
  const { history } = input
  if (history.status === 'UNRESOLVED_EXERCISE_IDENTITY') {
    return insufficientResult(history, 'UNRESOLVED_EXERCISE_IDENTITY')
  }

  const exposures = history.exposures.filter((exposure) => exposure.exerciseId === history.exerciseId)
  const currentExposure = exposures[0]
  if (!currentExposure) return insufficientResult(history, 'NO_CURRENT_EXPOSURE')

  const previousExposures = exposures.slice(1)
  if (!previousExposures.length) {
    return {
      ...insufficientResult(history, 'NO_PREVIOUS_EXPOSURE'),
      currentExposure,
      evidence: { ...emptyEvidence(), currentWorkoutId: currentExposure.workoutId },
    }
  }

  const consideredPreviousWorkoutIds: string[] = []
  const nonComparableExposures: NonComparableExposureEvidence[] = []
  let comparisonExposure = previousExposures[0]
  let foundComparable = false

  for (const candidate of previousExposures) {
    consideredPreviousWorkoutIds.push(candidate.workoutId)
    const comparability = classifyExerciseComparability(
      currentExposure.equipmentSensitive || candidate.equipmentSensitive,
      currentExposure.gymContext,
      candidate.gymContext,
    )
    if (comparability.status === 'COMPARABLE') {
      comparisonExposure = candidate
      foundComparable = true
      break
    }
    nonComparableExposures.push({ workoutId: candidate.workoutId, comparability })
  }

  if (!foundComparable) {
    return {
      exerciseId: history.exerciseId,
      status: 'NOT_COMPARABLE',
      reasonCodes: [reasonForNonComparable(nonComparableExposures), 'NO_PREVIOUS_COMPARABLE_EXPOSURE'],
      currentExposure,
      comparisonExposure,
      evidence: {
        ...emptyEvidence(),
        currentWorkoutId: currentExposure.workoutId,
        consideredPreviousWorkoutIds,
        nonComparableExposures,
      },
      algorithmVersion: EXERCISE_PROGRESS_ALGORITHM_VERSION,
    }
  }

  const progress = classifyComparableExposureProgress(currentExposure, comparisonExposure)
  return {
    exerciseId: history.exerciseId,
    status: progress.status,
    reasonCodes: progress.reasonCodes,
    currentExposure,
    comparisonExposure,
    evidence: {
      currentWorkoutId: currentExposure.workoutId,
      comparisonWorkoutId: comparisonExposure.workoutId,
      consideredPreviousWorkoutIds,
      nonComparableExposures,
      currentCompleteSetIds: progress.currentCompleteSetIds,
      comparisonCompleteSetIds: progress.comparisonCompleteSetIds,
      unpairedCurrentSetIds: progress.unpairedCurrentSetIds,
      unpairedComparisonSetIds: progress.unpairedComparisonSetIds,
      setComparisons: progress.setComparisons,
    },
    algorithmVersion: EXERCISE_PROGRESS_ALGORITHM_VERSION,
  }
}
