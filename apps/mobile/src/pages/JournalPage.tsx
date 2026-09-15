import { useEffect,useState,type FormEvent } from 'react'
import { activeJournalMetrics,findDailyEntryByDate,journalConfiguration,journalMeasurementChanges,journalMeasurementDraft,validJournalDate,type DailyEntry } from '@greekgod/core'
import { useMobileData } from '../context/MobileDataContext'
import { isoToday } from '../domain/mobileModel'
export const JournalPage=()=>{
  const {data,editDailyEntry,reload,saving}=useMobileData()
  const [date,setDate]=useState(isoToday()),[baseline,setBaseline]=useState<DailyEntry>()
  const [numbers,setNumbers]=useState(()=>journalMeasurementDraft()),[touched,setTouched]=useState<Set<string>>(()=>new Set())
  const [note,setNote]=useState(''),[noteTouched,setNoteTouched]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState('')
  const load=(entry?:DailyEntry)=>{setBaseline(structuredClone(entry));setNumbers(journalMeasurementDraft(entry));setTouched(new Set());setNote(entry?.note??'');setNoteTouched(false);setBlocked(false);setMessage('')}
  useEffect(()=>{load(data&&findDailyEntryByDate(data.dailyEntries,date))},[date,!!data])
  if(!data)return null
  const fields=validJournalDate(date)?activeJournalMetrics(journalConfiguration(data),date):[]
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(saving||blocked)return
    try{const result=await editDailyEntry({date,newId:crypto.randomUUID(),baseline,metricChanges:journalMeasurementChanges(numbers,touched),changes:noteTouched?[note?{field:'note',action:'SET',value:note}:{field:'note',action:'CLEAR'}]:[]})
      if(result.status==='APPLIED'){load(findDailyEntryByDate(result.snapshot.data.dailyEntries,date));setMessage('Wpis zapisany.')}
      else{setBlocked(true);setMessage(result.message)}
    }catch(error){setMessage(String(error))}
  }
  return <main className="mobile-page"><p className="eyebrow">Codzienny check-in</p><h1>Dziennik</h1><form className="mobile-form" onSubmit={(event)=>void submit(event)}>
    <fieldset disabled={saving||blocked}><label className="mobile-field full"><span>Data</span><input type="date" required value={date} onChange={(event)=>setDate(event.target.value)}/></label>
    <div className="form-grid">{fields.map((metric)=><label className="mobile-field" key={metric.id}><span>{metric.label}</span><div><input type="text" inputMode={metric.integer?'numeric':'decimal'} value={numbers[metric.id]??''} onChange={(event)=>{setNumbers({...numbers,[metric.id]:event.target.value});setTouched(new Set([...touched,metric.id]))}} placeholder="—"/><small>{metric.unit==='count'?'':metric.unit}</small></div></label>)}</div>
    <label className="mobile-field full"><span>Notatki</span><textarea rows={4} value={note} onChange={(event)=>{setNote(event.target.value);setNoteTouched(true)}}/></label></fieldset>
    <p role="status">{message}</p><button className="primary-button" disabled={saving||blocked||!validJournalDate(date)||(!touched.size&&!noteTouched)}>Zapisz Dziennik</button>
    <button type="button" className="secondary-button" disabled={saving} onClick={async()=>{const fresh=await reload();if(fresh)load(findDailyEntryByDate(fresh.data.dailyEntries,date));else setMessage('Nie udało się odświeżyć danych.')}}>Odrzuć draft / wczytaj zapisany wpis</button>
    <p className="safe-copy">Konfiguracja i historia śledzenia pochodzą z PC. Wyłączenie metryki nie usuwa wcześniejszych pomiarów.</p>
  </form></main>
}
