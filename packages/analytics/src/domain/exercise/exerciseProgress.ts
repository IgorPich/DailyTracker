import type {
  ExerciseComparability,
  SetPerformanceOutcome,
  SetPerformanceReason,
} from '@greekgod/core'
import type { ExerciseExposure } from './exerciseExposure.ts'

export const EXERCISE_PROGRESS_ALGORITHM_VERSION = 'exercise-progress-v1' as const

export type ExerciseProgressStatus =
  | 'PROGRESS'
  | 'FLAT'
  | 'REGRESSION'
  | 'NOT_COMPARABLE'
  | 'INSUFFICIENT_DATA'

export type ExerciseProgressReasonCode =
  | SetPerformanceReason
  | 'UNRESOLVED_EXERCISE_IDENTITY'
  | 'NO_CURRENT_EXPOSURE'
  | 'NO_PREVIOUS_EXPOSURE'
  | 'NO_PREVIOUS_COMPARABLE_EXPOSURE'
  | 'DIFFERENT_GYM_EQUIPMENT'
  | 'MISSING_GYM_CONTEXT'
  | 'NO_COMPARABLE_COMPLETE_SET_PAIR'
  | 'MIXED_SET_PERFORMANCE'
  | 'PERFORMANCE_TRADE_OFF'
  | 'SET_COUNT_CHANGED'

export interface ExerciseProgressSetComparison {
  pairOrder: number
  currentSetId: string
  previousSetId: string
  outcome: SetPerformanceOutcome
  reason: SetPerformanceReason
  weightDelta?: number
  repsDelta?: number
  sensibleRepFloor?: number
}

export interface NonComparableExposureEvidence {
  workoutId: string
  comparability: ExerciseComparability
}

export interface ExerciseProgressEvidence {
  currentWorkoutId?: string
  comparisonWorkoutId?: string
  consideredPreviousWorkoutIds: string[]
  nonComparableExposures: NonComparableExposureEvidence[]
  currentCompleteSetIds: string[]
  comparisonCompleteSetIds: string[]
  unpairedCurrentSetIds: string[]
  unpairedComparisonSetIds: string[]
  setComparisons: ExerciseProgressSetComparison[]
}

export interface ExerciseProgressResult {
  exerciseId: string
  status: ExerciseProgressStatus
  reasonCodes: ExerciseProgressReasonCode[]
  currentExposure?: ExerciseExposure
  comparisonExposure?: ExerciseExposure
  evidence: ExerciseProgressEvidence
  algorithmVersion: typeof EXERCISE_PROGRESS_ALGORITHM_VERSION
}
