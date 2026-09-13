import type { TargetSpecification } from '@greekgod/human-coach'

export type ProposedTarget = Exclude<TargetSpecification, { type: 'REP_RANGE' }>
  | { type: 'REP_RANGE'; scope: 'EXERCISE'; exerciseId: string | null; min: number; max: number; unit: 'reps' }

/** Closed v1 schema. TASK/DECISION permit at most one link, matching the current manual form. */
export type ProposedDraftFields =
  | { kind: 'TASK'; title: string; description?: string; exerciseIds: string[] }
  | { kind: 'TARGET'; title: string; specification: ProposedTarget }
  | { kind: 'DECISION'; text: string; exerciseIds: string[] }

export interface ProposedCoachDraft {
  readonly sourceNoteId: string
  readonly fields: ProposedDraftFields
}
