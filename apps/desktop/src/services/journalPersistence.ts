import type { AppData, DailyEntryEdit, JournalConfigurationPlan } from '@greekgod/core'
export type JournalMutation = {kind:'ENTRY';plan:DailyEntryEdit} | {kind:'CONFIGURATION';plan:JournalConfigurationPlan}
export type JournalSaveResult = {status:'APPLIED';data:AppData} | {status:'STALE'|'VALIDATION_FAILED'|'PERSISTENCE_FAILED'|'INDETERMINATE'|'BLOCKED';message:string}
export interface JournalPersistence {
  readonly supportsJournalSave:boolean
  saveJournal(request:JournalMutation):Promise<JournalSaveResult>
}
