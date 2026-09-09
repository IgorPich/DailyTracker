import type {
  ExerciseComparability,
  ExerciseIdentityIssueReason,
} from '@greekgod/core'

export interface ExerciseExposureWorkingSet {
  setId: string
  workoutExerciseId: string
  exerciseOrder: number
  setOrder: number
  weight?: number
  reps?: number
  rir?: number
}

export interface ExerciseExposureReference {
  workoutExerciseId: string
  displayNameSnapshot: string
  prescriptionSnapshot?: string
  workingSets: ExerciseExposureWorkingSet[]
}

export interface ExerciseExposure {
  exerciseId: string
  workoutId: string
  workoutExerciseId: string
  occurredOn: string
  gymContext?: string
  templateId: string
  templateCode: string
  templateName: string
  displayNameSnapshot: string
  prescriptionSnapshot?: string
  workingSets: ExerciseExposureWorkingSet[]
  references: ExerciseExposureReference[]
  comparability: ExerciseComparability
  evidence: {
    workoutId: string
    workoutExerciseIds: string[]
    setIds: string[]
  }
}

export interface ExerciseExposureIdentityIssue {
  classification: 'UNRESOLVED_EXERCISE_IDENTITY'
  reason: ExerciseIdentityIssueReason
  workoutId: string
  workoutExerciseId: string
  exerciseId?: string
}

export interface ExerciseExposureDataQuality {
  excludedReferenceCount: number
  issues: ExerciseExposureIdentityIssue[]
}

export interface ResolvedExerciseExposureHistory {
  status: 'READY'
  exerciseId: string
  exposures: ExerciseExposure[]
  dataQuality: ExerciseExposureDataQuality
}

export interface UnresolvedExerciseExposureHistory {
  status: 'UNRESOLVED_EXERCISE_IDENTITY'
  exerciseId: string
  reason: ExerciseIdentityIssueReason
  exposures: []
  dataQuality: ExerciseExposureDataQuality
}

export type ExerciseExposureHistoryResult =
  | ResolvedExerciseExposureHistory
  | UnresolvedExerciseExposureHistory
