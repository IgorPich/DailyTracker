import type { ExerciseProgressResult } from '../exercise/exerciseProgress.ts'

export const REPORT_SELECTION_VERSION = 'report-selection-v1' as const

export type ReportSelectionReason =
  | 'RECENT_EXPOSURE'
  | 'ACTIVE_TEMPLATE'
  | 'MEANINGFUL_CHANGE'
  | 'NEEDS_ATTENTION'
  | 'INSUFFICIENT_COMPARABLE_HISTORY'

export type ReportSelectionPriority =
  | 'RECENT_REGRESSION'
  | 'RECENT_MIXED_OR_TRADE_OFF'
  | 'RECENT_PROGRESS'
  | 'RECENT_NOT_COMPARABLE'
  | 'RECENT_INSUFFICIENT_DATA'
  | 'RECENT_STABLE'
  | 'ACTIVE_TEMPLATE_ONLY'

export interface SelectedReportExercise {
  exerciseId: string
  selectionReasons: ReportSelectionReason[]
  progress: ExerciseProgressResult
  evidence: {
    activeTemplateIds: string[]
    recentExposures: Array<{
      workoutId: string
      workoutExerciseIds: string[]
      setIds: string[]
    }>
  }
  ranking: {
    priority: ReportSelectionPriority
    priorityOrder: number
    latestRecentExposureOn?: string
    activeTemplate: boolean
    sourceOrder: number
  }
}

export interface ReportSelectionResult {
  asOf: string
  recentFrom: string
  reportSelectionVersion: typeof REPORT_SELECTION_VERSION
  selectedExercises: SelectedReportExercise[]
  excludedExercises: Array<{
    exerciseId: string
    reason: 'UNRESOLVED_EXERCISE_IDENTITY' | 'NO_RECENT_EXPOSURE_OR_ACTIVE_TEMPLATE' | 'DISPLAY_LIMIT'
  }>
  eligibleExerciseCount: number
}

// Priority is about the evidence worth showing, never a coaching instruction.
export const reportPriority = (progress: ExerciseProgressResult, recentCurrent: boolean): ReportSelectionPriority => {
  if (!recentCurrent) return 'ACTIVE_TEMPLATE_ONLY'
  if (progress.status === 'REGRESSION') return 'RECENT_REGRESSION'
  if (progress.status === 'FLAT' && progress.reasonCodes.some((reason) =>
    reason === 'MIXED_SET_PERFORMANCE' || reason === 'PERFORMANCE_TRADE_OFF' || reason === 'SET_COUNT_CHANGED',
  )) return 'RECENT_MIXED_OR_TRADE_OFF'
  if (progress.status === 'PROGRESS') return 'RECENT_PROGRESS'
  if (progress.status === 'NOT_COMPARABLE') return 'RECENT_NOT_COMPARABLE'
  if (progress.status === 'INSUFFICIENT_DATA') return 'RECENT_INSUFFICIENT_DATA'
  return 'RECENT_STABLE'
}

export const REPORT_PRIORITY_ORDER: Record<ReportSelectionPriority, number> = {
  RECENT_REGRESSION: 0,
  RECENT_MIXED_OR_TRADE_OFF: 1,
  RECENT_PROGRESS: 2,
  RECENT_NOT_COMPARABLE: 3,
  RECENT_INSUFFICIENT_DATA: 4,
  RECENT_STABLE: 5,
  ACTIVE_TEMPLATE_ONLY: 6,
}
