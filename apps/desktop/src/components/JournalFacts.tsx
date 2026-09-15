import { journalMetric, type AppData } from '@greekgod/core'
import { journalMetricFacts } from '../adapters/journalReporting'
import { formatDecimal } from '../utils/numbers'
export function JournalFacts({data,from,to}:{data:AppData;from:string;to:string}) {
  return <section className="card"><h3>Metryki dziennika</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Metryka</th><th>Dostępność</th><th>Średnia pomiarów</th></tr></thead><tbody>{journalMetricFacts(data,from,to).map((fact)=><tr key={fact.metricId}><td>{journalMetric(fact.metricId).label}</td><td>{fact.status==='NOT_TRACKED'?'Nieśledzona w tym okresie':`${fact.measurementCount}/${fact.trackedDayCount} śledzonych dni`}</td><td>{fact.average===null?'—':`${formatDecimal(fact.average)} ${fact.unit==='count'?'':fact.unit}`}</td></tr>)}</tbody></table></div></section>
}
