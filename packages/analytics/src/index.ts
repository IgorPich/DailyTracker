export { exerciseExposureHistory } from './application/exercise-history/exerciseExposureHistory.ts'
export type { ExerciseExposureHistoryQuery } from './application/exercise-history/exerciseExposureHistory.ts'
export { exerciseProgressClassification } from './application/exercise-progress/exerciseProgressClassification.ts'
export type { ExerciseProgressClassificationInput } from './application/exercise-progress/exerciseProgressClassification.ts'
export { EXERCISE_PROGRESS_ALGORITHM_VERSION } from './domain/exercise/exerciseProgress.ts'
export type {
  ExerciseExposure,
  ExerciseExposureDataQuality,
  ExerciseExposureHistoryResult,
  ExerciseExposureIdentityIssue,
  ExerciseExposureReference,
  ExerciseExposureWorkingSet,
  ResolvedExerciseExposureHistory,
  UnresolvedExerciseExposureHistory,
} from './domain/exercise/exerciseExposure.ts'
export type {
  ExerciseProgressEvidence,
  ExerciseProgressReasonCode,
  ExerciseProgressResult,
  ExerciseProgressSetComparison,
  ExerciseProgressStatus,
  NonComparableExposureEvidence,
} from './domain/exercise/exerciseProgress.ts'
export type { TrackingExerciseHistorySnapshot } from './ports/trackingExerciseHistorySnapshot.ts'
