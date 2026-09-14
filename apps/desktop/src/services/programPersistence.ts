import type { AppData, ProgramPlan } from '@greekgod/core'
export type ProgramSaveResult = { status: 'APPLIED'; data: AppData; resultingRevision: number }
  | { status: 'VALIDATION_FAILED' | 'STALE_PROGRAM' | 'PERSISTENCE_FAILED' | 'BLOCKED'; message: string }
  | { status: 'INDETERMINATE'; message: string; desiredProgramPresent?: boolean }
/** User-driven Builder capability; never supplied to Companion. */
export interface ProgramPersistence {
  readonly supportsProgramSave: boolean
  saveProgram(plan: ProgramPlan): Promise<ProgramSaveResult>
}
