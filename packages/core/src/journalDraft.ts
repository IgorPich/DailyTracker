import type { DailyEntry } from './types.ts'
import { JOURNAL_METRICS, journalMetric, measurementValue } from './journalMetrics.ts'
import { normalizeDecimalInput } from './numbers.ts'
import type { MetricValueChange } from './dailyEntryEdit.ts'
export const journalMeasurementDraft = (entry?: DailyEntry):Record<string,string> => Object.fromEntries(JOURNAL_METRICS.map((metric)=>[metric.id,measurementValue(entry,metric.id)?.toString() ?? '']))
export const journalMeasurementChanges = (draft:Record<string,string>,touched:Iterable<string>):MetricValueChange[] => [...touched].map((metricId)=>{
  const definition=journalMetric(metricId),raw=draft[metricId]?.trim() ?? ''
  if (!raw) return {metricId,action:'CLEAR'}
  const value=normalizeDecimalInput(raw)
  if (value===undefined || value<0 || (definition.integer&&!Number.isInteger(value))) throw new Error(`Nieprawidłowa wartość: ${definition.label}`)
  return {metricId,action:'SET',value}
})
