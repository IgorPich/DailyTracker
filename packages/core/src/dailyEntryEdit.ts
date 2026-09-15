import type { AppData, DailyEntry } from './types.ts'
import { upsertDailyEntry } from './dailyEntryOperations.ts'

export type DailyEditField = Exclude<keyof DailyEntry, 'id' | 'date'>
export type DailyFieldChange = { field: DailyEditField; action: 'SET'; value: number | string } | { field: DailyEditField; action: 'CLEAR' }
export interface DailyEntryEdit { date: string; newId: string; baseline?: DailyEntry; changes: DailyFieldChange[] }
const numeric = new Set(['weight','waist','calories','protein','carbs','fat','steps','sleep','recovery'])
/** Local field intent, not a cross-device merge protocol. Omitted fields are UNCHANGED. */
export const applyDailyEntryEdit = (data: AppData, plan: DailyEntryEdit): AppData => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.date) || !plan.newId.trim() || (plan.baseline && plan.baseline.date !== plan.date)) throw new Error('INVALID_EDIT')
  const matching = data.dailyEntries.filter((entry) => entry.date === plan.date)
  const fresh = matching[0]
  if (matching.length > 1 || (plan.baseline && (!fresh || fresh.id !== plan.baseline.id))) throw new Error('STALE')
  const next = structuredClone(fresh ?? { id: plan.newId, date: plan.date })
  const seen = new Set<string>()
  for (const change of plan.changes) {
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
  if (!plan.changes.length) return data
  return { ...data, dailyEntries: upsertDailyEntry(data.dailyEntries, next) }
}
