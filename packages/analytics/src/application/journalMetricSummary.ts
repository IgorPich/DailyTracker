import { journalConfiguration, journalMetric, measurementValue, metricIsTracked, validJournalDate, type AppData } from '@greekgod/core'
export interface JournalMetricQuery { snapshot:Pick<AppData,'settings'|'dailyEntries'>; metricId:string; from:string; to:string }
export const journalMetricSummary = ({snapshot,metricId,from,to}:JournalMetricQuery) => {
  if (!validJournalDate(from) || !validJournalDate(to) || from > to) throw new Error('Invalid inclusive metric range')
  const definition = journalMetric(metricId), configuration = journalConfiguration(snapshot)
  const start = Date.parse(`${from}T00:00:00Z`), days = Math.round((Date.parse(`${to}T00:00:00Z`)-start)/86_400_000)+1
  if (days > 100_000) throw new Error('Metric range too large')
  const entries = new Map(snapshot.dailyEntries.map((entry)=>[entry.date,entry]))
  const points = Array.from({length:days},(_,index)=>{
    const date = new Date(start+index*86_400_000).toISOString().slice(0,10)
    const tracked = metricIsTracked(configuration,metricId,date), value = measurementValue(entries.get(date),metricId)
    return {date,value,status:!tracked?'NOT_TRACKED' as const:value === undefined?'MISSING_DATA' as const:'AVAILABLE' as const}
  })
  const trackedDayCount = points.filter((point)=>point.status !== 'NOT_TRACKED').length
  const values = points.filter((point)=>point.status === 'AVAILABLE').map((point)=>point.value!)
  return {metricId,unit:definition.unit,from,to,points,trackedDayCount,notTrackedDayCount:days-trackedDayCount,
    missingDayCount:trackedDayCount-values.length,measurementCount:values.length,coverage:trackedDayCount?values.length/trackedDayCount:null,
    average:values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null,
    status:!trackedDayCount?'NOT_TRACKED' as const:!values.length?'MISSING_DATA' as const:'AVAILABLE' as const}
}
