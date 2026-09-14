import type { AppData, TemplateRepRangePlan } from '@greekgod/core'

export interface AppliedActionReceipt {
  action: 'CHANGE_TEMPLATE_REP_RANGE'
  templateId: string
  templateExerciseId: string
  exerciseId: string
  beforePrescription: string
  afterPrescription: string
  appliedAt: string
  resultingRevision: number
}
export type TrackingMutationResult =
  | { status: 'APPLIED'; data: AppData; receipt: AppliedActionReceipt }
  | { status: 'STALE' | 'FAILED' | 'BLOCKED'; message: string }
  | { status: 'INDETERMINATE'; message: string; reconciliation?: { desiredStatePresent: boolean; observedPrescription?: string } }

export interface ConfirmedTrackingPersistence {
  readonly supportsConfirmedTrackingMutations: boolean
  changeTemplateRepRange(plan: TemplateRepRangePlan): Promise<TrackingMutationResult>
}
