import { JOURNAL_METRICS, journalConfiguration, measurementValue, metricIsTracked, validJournalDate, type AppData } from '@greekgod/core'
import { journalMetricSummary } from '@greekgod/analytics'
/** Derived view ONLY. Never persisted; keeps existing seven-day arithmetic unchanged. */
export const journalReportingSnapshot = (data:AppData,asOf:string):AppData => {
  const config=journalConfiguration(data)
  return {...data,dailyEntries:data.dailyEntries.map((entry)=>{
    const view={...entry}
    for(const metric of JOURNAL_METRICS) if(metric.legacyField){
      if(!validJournalDate(entry.date)||!metricIsTracked(config,metric.id,entry.date)||!metricIsTracked(config,metric.id,asOf))delete view[metric.legacyField]
      else view[metric.legacyField]=measurementValue(entry,metric.id)
    }
    return view
  })}
}
export const journalMetricFacts=(data:AppData,from:string,to:string)=>journalConfiguration(data).metrics.map((metric)=>journalMetricSummary({snapshot:data,metricId:metric.metricId,from,to}))
export const companionJournalEvidence=(data:AppData,from:string,to:string)=>journalMetricFacts(data,from,to).map((fact)=>({
  id:`journal:${fact.metricId}:${from}:${to}`,
  text:JSON.stringify({metricId:fact.metricId,status:fact.status,trackedDays:fact.trackedDayCount,measurementCount:fact.measurementCount,coverage:fact.coverage,average:fact.average,unit:fact.unit}),
}))
