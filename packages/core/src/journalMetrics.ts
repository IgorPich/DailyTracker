import type { AppData, DailyEntry } from './types.ts'

type LegacyMetricField = 'weight'|'waist'|'calories'|'protein'|'carbs'|'fat'|'steps'|'sleep'|'recovery'
export interface JournalMetricDefinition { id: string; label: string; unit: string; integer: boolean; legacyField?: LegacyMetricField; defaultTracked: boolean }
/** System metadata, not a user configuration or a coaching rule. */
export const JOURNAL_METRICS: readonly JournalMetricDefinition[] = [
  {id:'WEIGHT',label:'Masa',unit:'kg',integer:false,legacyField:'weight',defaultTracked:true},
  {id:'WAIST',label:'Talia',unit:'cm',integer:false,legacyField:'waist',defaultTracked:true},
  {id:'CALORIES',label:'Kalorie',unit:'kcal',integer:true,legacyField:'calories',defaultTracked:true},
  {id:'PROTEIN',label:'Białko',unit:'g',integer:false,legacyField:'protein',defaultTracked:true},
  {id:'CARBS',label:'Węglowodany',unit:'g',integer:false,legacyField:'carbs',defaultTracked:true},
  {id:'FAT',label:'Tłuszcz',unit:'g',integer:false,legacyField:'fat',defaultTracked:true},
  {id:'STEPS',label:'Kroki',unit:'count',integer:true,legacyField:'steps',defaultTracked:true},
  {id:'SLEEP',label:'Sen (wartość historyczna)',unit:'',integer:false,legacyField:'sleep',defaultTracked:false},
  {id:'RECOVERY',label:'Regeneracja (wartość historyczna)',unit:'',integer:false,legacyField:'recovery',defaultTracked:false},
  {id:'CHEST',label:'Klatka piersiowa',unit:'cm',integer:false,defaultTracked:false},
  {id:'BICEPS',label:'Biceps',unit:'cm',integer:false,defaultTracked:false},
]
export const journalMetric = (id: string) => {
  const result = JOURNAL_METRICS.find((metric) => metric.id === id)
  if (!result) throw new Error('Unknown metricId')
  return result
}
export interface MetricTracking { metricId: string; initiallyTracked: boolean; transitions: Array<{from:string;tracked:boolean}> }
export interface JournalConfiguration { version:1; metrics:MetricTracking[] }
export const validJournalDate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === date
}
export const measurementValue = (entry: DailyEntry | undefined, metricId: string): number | undefined => {
  const metric = journalMetric(metricId)
  const value = metric.legacyField ? entry?.[metric.legacyField] : entry?.measurements?.[metricId]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
export const validateJournalConfiguration = (configuration: JournalConfiguration) => {
  if (configuration?.version !== 1 || !Array.isArray(configuration.metrics) || configuration.metrics.length !== JOURNAL_METRICS.length) throw new Error('Invalid journal configuration')
  const ids = new Set<string>()
  for (const item of configuration.metrics) {
    journalMetric(item.metricId)
    if (ids.has(item.metricId) || typeof item.initiallyTracked !== 'boolean' || !Array.isArray(item.transitions)) throw new Error('Invalid metric tracking')
    ids.add(item.metricId)
    let previous = ''
    for (const event of item.transitions) {
      if (!validJournalDate(event.from) || event.from <= previous || typeof event.tracked !== 'boolean') throw new Error('Invalid tracking periods')
      previous = event.from
    }
  }
}
export const journalConfiguration = (data: Pick<AppData,'settings'|'dailyEntries'>): JournalConfiguration => {
  if (data.settings.journalConfiguration !== undefined) {
    validateJournalConfiguration(data.settings.journalConfiguration)
    return structuredClone(data.settings.journalConfiguration)
  }
  return {version:1,metrics:JOURNAL_METRICS.map((metric) => ({metricId:metric.id,
    initiallyTracked:metric.defaultTracked || !!metric.legacyField && data.dailyEntries.some((entry) => entry[metric.legacyField!] !== undefined),transitions:[]}))}
}
export const metricIsTracked = (configuration: JournalConfiguration, metricId: string, date: string): boolean => {
  if (!validJournalDate(date)) throw new Error('Invalid date')
  const item = configuration.metrics.find((metric) => metric.metricId === metricId)
  if (!item) throw new Error('Unknown configured metric')
  return item.transitions.reduce((tracked,event) => event.from <= date ? event.tracked : tracked,item.initiallyTracked)
}
export const activeJournalMetrics = (configuration: JournalConfiguration,date:string) => configuration.metrics
  .filter((metric) => metricIsTracked(configuration,metric.metricId,date)).map((metric) => journalMetric(metric.metricId))
export const changeMetricTracking = (configuration: JournalConfiguration,id:string,from:string,tracked:boolean): JournalConfiguration => {
  if (!validJournalDate(from)) throw new Error('Invalid effective date')
  const next = structuredClone(configuration)
  const metric = next.metrics.find((item) => item.metricId === id)
  if (!metric || metric.transitions.some((event) => event.from > from)) throw new Error('Cannot overwrite later tracking history')
  metric.transitions = [...metric.transitions.filter((event) => event.from !== from),{from,tracked}]
  validateJournalConfiguration(next); return next
}
export interface JournalConfigurationPlan { baseline:string; configuration:JournalConfiguration }
export const journalConfigurationBaseline = (data: Pick<AppData,'settings'|'dailyEntries'>) => JSON.stringify({version:1,metrics:journalConfiguration(data).metrics.map((item) => ({metricId:item.metricId,initiallyTracked:item.initiallyTracked,transitions:item.transitions.map((event) => ({from:event.from,tracked:event.tracked}))}))})
export const applyJournalConfiguration = (data: AppData, plan: JournalConfigurationPlan): AppData => {
  if (journalConfigurationBaseline(data) !== plan.baseline) throw new Error('STALE_CONFIGURATION')
  validateJournalConfiguration(plan.configuration)
  return {...data,settings:{...data.settings,journalConfiguration:structuredClone(plan.configuration)}}
}
