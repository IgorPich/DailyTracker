import { useState, type FormEvent } from 'react'
import { Edit3, Trash2 } from 'lucide-react'
import { activeJournalMetrics, findDailyEntryByDate, journalConfiguration, journalMeasurementChanges, journalMeasurementDraft, journalMetric, measurementValue, metricIsTracked, validJournalDate, type DailyEntry } from '@greekgod/core'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../context/AppContext'
import { formatLongDate, isoToday } from '../utils/date'
import { formatDecimal } from '../utils/numbers'
export function Journal() {
  const {data,journalPersistence,deleteDailyEntry}=useApp()
  const [date,setDate]=useState(isoToday())
  const [baseline,setBaseline]=useState<DailyEntry|undefined>(()=>structuredClone(findDailyEntryByDate(data.dailyEntries,date)))
  const [numbers,setNumbers]=useState(()=>journalMeasurementDraft(baseline)),[touched,setTouched]=useState<Set<string>>(()=>new Set())
  const [note,setNote]=useState(baseline?.note ?? ''),[noteTouched,setNoteTouched]=useState(false)
  const [busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState(''),[sortNewest,setSortNewest]=useState(true)
  const config=journalConfiguration(data), fields=validJournalDate(date)?activeJournalMetrics(config,date):[]
  const columns=config.metrics.map((item)=>journalMetric(item.metricId)).filter((metric)=>metricIsTracked(config,metric.id,isoToday())||data.dailyEntries.some((entry)=>measurementValue(entry,metric.id)!==undefined))
  const load=(entry:DailyEntry|undefined,day:string)=>{setDate(day);setBaseline(structuredClone(entry));setNumbers(journalMeasurementDraft(entry));setTouched(new Set());setNote(entry?.note??'');setNoteTouched(false);setBlocked(false);setMessage('')}
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(busy||blocked)return;setBusy(true)
    try {
      const result=await journalPersistence.saveJournal({kind:'ENTRY',plan:{date,newId:crypto.randomUUID(),baseline,
        changes:noteTouched?[note.trim()?{field:'note',action:'SET',value:note.trim()}:{field:'note',action:'CLEAR'}]:[],metricChanges:journalMeasurementChanges(numbers,touched)}})
      if(result.status==='APPLIED'){load(findDailyEntryByDate(result.data.dailyEntries,date),date);setMessage('Wpis zapisany.')}
      else{setMessage(`${result.status}: ${result.message}`);setBlocked(true)}
    }catch(error){setMessage(String(error))}finally{setBusy(false)}
  }
  return <div className="page journal-page journal-v2"><PageHeader eyebrow="DZIENNIK" title="Dziennik" description="Metryki zgodne z konfiguracją i datą wpisu. Brak wartości nie oznacza zera. Historia wyłączonych metryk pozostaje zachowana."/>
    {!journalPersistence.supportsJournalSave && <p role="status">Zapis dziennika wymaga dostępnej natywnej bazy Desktop. Podgląd nie zapisuje zmian.</p>}
    <form className="card daily-form daily-form-v2" onSubmit={(event)=>void submit(event)}><fieldset disabled={busy||blocked}>
      <div className="quick-entry-grid"><label className="field field--date"><span>Data</span><input type="date" required value={date} onChange={(event)=>load(findDailyEntryByDate(data.dailyEntries,event.target.value),event.target.value)}/></label>
        {fields.map((metric)=><label className="field" key={metric.id}><span>{metric.label}</span><div className="input-with-unit"><input type="text" inputMode={metric.integer?'numeric':'decimal'} value={numbers[metric.id]??''} onChange={(event)=>{setNumbers({...numbers,[metric.id]:event.target.value});setTouched(new Set([...touched,metric.id]))}} placeholder="—"/><span>{metric.unit==='count'?'':metric.unit}</span></div></label>)}
      </div><label className="field journal-note"><span>Notatka</span><textarea value={note} onChange={(event)=>{setNote(event.target.value);setNoteTouched(true)}}/></label>
    </fieldset><div className="form-footer"><button className="button button--primary" disabled={busy||blocked||!validJournalDate(date)||(!touched.size&&!noteTouched)||!journalPersistence.supportsJournalSave}>Zapisz wpis</button>
      <button type="button" className="button button--ghost" disabled={busy||!journalPersistence.supportsJournalSave} onClick={()=>load(findDailyEntryByDate(data.dailyEntries,date),date)}>Odrzuć draft / wczytaj zapisane</button></div><p role="status">{message}</p></form>
    <section className="card history-card"><div className="card-heading"><h2>Historia wpisów</h2><button className="button button--ghost" onClick={()=>setSortNewest(!sortNewest)}>Zmień kolejność dat</button></div>
      <div className="table-scroll"><table className="data-table journal-table"><thead><tr><th>Data</th>{columns.map((metric)=><th key={metric.id}>{metric.label}</th>)}<th>Notatka</th><th>Akcje</th></tr></thead>
      <tbody>{[...data.dailyEntries].sort((a,b)=>sortNewest?b.date.localeCompare(a.date):a.date.localeCompare(b.date)).map((entry)=><tr key={entry.id}><td>{formatLongDate(entry.date)}</td>{columns.map((metric)=><td key={metric.id}>{measurementValue(entry,metric.id)===undefined?'—':`${formatDecimal(measurementValue(entry,metric.id))} ${metric.unit==='count'?'':metric.unit}`}</td>)}<td>{entry.note||'—'}</td><td><button className="icon-button" disabled={busy} onClick={()=>load(entry,entry.date)} aria-label="Edytuj"><Edit3 size={16}/></button><button className="icon-button" onClick={()=>{if(window.confirm(`Usunąć wpis z ${entry.date}?`))deleteDailyEntry(entry.id)}} aria-label="Usuń"><Trash2 size={16}/></button></td></tr>)}</tbody></table></div>
    </section></div>
}
