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
export { reportSelection } from './application/report-selection/reportSelection.ts'
export { trainingTimeSummary } from './application/training-time/trainingTimeSummary.ts'
export type { TrainingTimeSummaryQuery, TrainingTimeSummaryResult } from './application/training-time/trainingTimeSummary.ts'
export type { ReportSelectionQuery } from './application/report-selection/reportSelection.ts'
export { REPORT_SELECTION_VERSION } from './domain/report/reportSelection.ts'
export type { ReportSelectionResult, SelectedReportExercise, ReportSelectionReason, ReportSelectionPriority } from './domain/report/reportSelection.ts'
