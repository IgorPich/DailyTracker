import type { AppData, DailyEntry } from './types.ts'
import { upsertDailyEntry } from './dailyEntryOperations.ts'
import { journalMetric, validJournalDate } from './journalMetrics.ts'

export type DailyEditField = Exclude<keyof DailyEntry, 'id' | 'date' | 'measurements'>
export type DailyFieldChange = { field: DailyEditField; action: 'SET'; value: number | string } | { field: DailyEditField; action: 'CLEAR' }
export interface MetricValueChange { metricId:string; action:'SET'|'CLEAR'; value?:number }
export interface DailyEntryEdit { date: string; newId: string; baseline?: DailyEntry; changes: DailyFieldChange[]; metricChanges?:MetricValueChange[] }
const numeric = new Set(['weight','waist','calories','protein','carbs','fat','steps','sleep','recovery'])
/** Local field intent, not a cross-device merge protocol. Omitted fields are UNCHANGED. */
export const applyDailyEntryEdit = (data: AppData, plan: DailyEntryEdit): AppData => {
  if (!validJournalDate(plan.date) || !plan.newId.trim() || (plan.baseline && plan.baseline.date !== plan.date)) throw new Error('INVALID_EDIT')
  const matching = data.dailyEntries.filter((entry) => entry.date === plan.date)
  const fresh = matching[0]
  if (!fresh && data.dailyEntries.some((entry) => entry.id === plan.newId)) throw new Error('INVALID_EDIT_ID_COLLISION')
  if (matching.length > 1 || (plan.baseline && (!fresh || fresh.id !== plan.baseline.id))) throw new Error('STALE')
  const next = structuredClone(fresh ?? { id: plan.newId, date: plan.date })
  const seen = new Set<string>()
  const legacyChanges = [...plan.changes]
  const metricIds = new Set<string>()
  for (const change of plan.metricChanges ?? []) {
    const metric = journalMetric(change.metricId)
    if (metricIds.has(metric.id) || (change.action !== 'SET' && change.action !== 'CLEAR')) throw new Error('INVALID_EDIT')
    metricIds.add(metric.id)
    if (change.action === 'SET' && (typeof change.value !== 'number' || !Number.isFinite(change.value) || change.value < 0 || (metric.integer && !Number.isInteger(change.value)))) throw new Error('INVALID_EDIT')
    if (metric.legacyField) {
      legacyChanges.push(change.action === 'CLEAR' ? {field:metric.legacyField,action:'CLEAR'} : {field:metric.legacyField,action:'SET',value:change.value!})
    } else {
      if (!Object.is(fresh?.measurements?.[metric.id],plan.baseline?.measurements?.[metric.id])) throw new Error('STALE')
      next.measurements = {...next.measurements}
      if (change.action === 'CLEAR') delete next.measurements[metric.id]
      else next.measurements[metric.id] = change.value!
    }
  }
  for (const change of legacyChanges) {
    if ((!numeric.has(change.field) && change.field !== 'note') || seen.has(change.field)) throw new Error('INVALID_EDIT')
    seen.add(change.field)
    if (!Object.is(fresh?.[change.field], plan.baseline?.[change.field])) throw new Error('STALE')
    if (change.action === 'CLEAR') delete next[change.field]
    else if (change.action === 'SET') {
      if (change.field === 'note') {
        if (typeof change.value !== 'string') throw new Error('INVALID_EDIT')
        next.note = change.value
      } else {
        if (typeof change.value !== 'number' || !Number.isFinite(change.value) || change.value < 0) throw new Error('INVALID_EDIT')
        next[change.field] = change.value
      }
    } else throw new Error('INVALID_EDIT')
  }
  if (!plan.changes.length && !plan.metricChanges?.length) return data
  return { ...data, dailyEntries: upsertDailyEntry(data.dailyEntries, next) }
}
