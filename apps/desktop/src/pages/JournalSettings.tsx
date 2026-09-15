import { useState } from 'react'
import { changeMetricTracking, journalConfiguration, journalConfigurationBaseline, journalMetric, metricIsTracked, moveItem, validJournalDate } from '@greekgod/core'
import { useApp } from '../context/AppContext'
import { PageHeader } from '../components/PageHeader'
import { isoToday } from '../utils/date'
export function JournalSettings({onClose}:{onClose:()=>void}) {
  const {data,journalPersistence} = useApp()
  const [plan,setPlan] = useState(()=>({baseline:journalConfigurationBaseline(data),configuration:journalConfiguration(data)}))
  const [date,setDate] = useState(isoToday())
  const [busy,setBusy] = useState(false), [blocked,setBlocked] = useState(false), [message,setMessage] = useState('')
  const update = (action:()=>typeof plan.configuration) => { try {setPlan({...plan,configuration:action()});setMessage('')} catch(error){setMessage(String(error))} }
  return <div className="page"><PageHeader eyebrow="DZIENNIK" title="Dostosuj dziennik" description="Lokalny draft. Wyłączenie metryki nie usuwa pomiarów. Zmiana śledzenia obowiązuje od wskazanej daty; wcześniejsze okresy pozostają zapisane."/>
    {!journalPersistence.supportsJournalSave && <p role="status">Zapis konfiguracji wymaga dostępnej natywnej bazy Desktop. Podgląd nie zapisuje zmian.</p>}
    <label>Zmiany śledzenia od dnia<input type="date" value={date} disabled={busy||blocked} onChange={(event)=>setDate(event.target.value)}/></label>
    <p>Zmiany w tym samym dniu ustalają jeden stan dla całej daty.</p>
    <fieldset disabled={busy||blocked||!validJournalDate(date)}><legend>Metryki</legend>{plan.configuration.metrics.map((item,index)=><div className="card" key={item.metricId}>
      <label><input type="checkbox" checked={validJournalDate(date)&&metricIsTracked(plan.configuration,item.metricId,date)} onChange={(event)=>update(()=>changeMetricTracking(plan.configuration,item.metricId,date,event.target.checked))}/>{journalMetric(item.metricId).label}</label>
      <button type="button" disabled={!index} onClick={()=>update(()=>({...plan.configuration,metrics:moveItem(plan.configuration.metrics,index,index-1)}))}>↑</button>
      <button type="button" disabled={index===plan.configuration.metrics.length-1} onClick={()=>update(()=>({...plan.configuration,metrics:moveItem(plan.configuration.metrics,index,index+1)}))}>↓</button>
    </div>)}</fieldset>
    <button type="button" className="button button--primary" disabled={busy||blocked||!journalPersistence.supportsJournalSave} onClick={async()=>{
      setBusy(true)
      try {const result=await journalPersistence.saveJournal({kind:'CONFIGURATION',plan});setMessage(result.status==='APPLIED'?'Konfiguracja zapisana.':`${result.status}: ${result.message}`);if(result.status==='APPLIED')setPlan({baseline:journalConfigurationBaseline(result.data),configuration:journalConfiguration(result.data)});else setBlocked(true)} finally{setBusy(false)}
    }}>Zapisz konfigurację</button>
    <button type="button" className="button button--ghost" disabled={busy} onClick={onClose}>Anuluj / zamknij</button>
    <button type="button" className="button button--ghost" disabled={busy||!journalPersistence.supportsJournalSave} onClick={()=>{setPlan({baseline:journalConfigurationBaseline(data),configuration:journalConfiguration(data)});setBlocked(false);setMessage('')}}>Odrzuć draft / wczytaj zapisane</button>
    <p role="status">{message}</p>
  </div>
}
