import { useEffect, useState, type FormEvent } from 'react'
import { findDailyEntryByDate, type DailyEntry, type DailyEditField, type DailyFieldChange } from '@greekgod/core'
import { useMobileData } from '../context/MobileDataContext'
import { applyJournalNumericDraft, isoToday, journalDraft, journalNumericDraft, type JournalNumericKey } from '../domain/mobileModel'

const fields: Array<{ key: JournalNumericKey; label: string; unit: string; integer?: boolean }> = [
  { key: 'weight', label: 'Waga', unit: 'kg' }, { key: 'waist', label: 'Talia', unit: 'cm' },
  { key: 'calories', label: 'Kalorie', unit: 'kcal', integer: true }, { key: 'protein', label: 'Białko', unit: 'g', integer: true },
  { key: 'carbs', label: 'Węglowodany', unit: 'g', integer: true }, { key: 'fat', label: 'Tłuszcze', unit: 'g', integer: true },
  { key: 'steps', label: 'Kroki', unit: '', integer: true },
]

export const JournalPage = () => {
  const { data, editDailyEntry, reload, saving } = useMobileData()
  const [date, setDate] = useState(isoToday())
  const existing = data ? findDailyEntryByDate(data.dailyEntries, date) : undefined
  const [draft, setDraft] = useState<DailyEntry>(() => journalDraft(existing, date))
  const [baseline, setBaseline] = useState(() => existing && structuredClone(existing))
  const [touched, setTouched] = useState<Set<DailyEditField>>(() => new Set())
  const [blocked, setBlocked] = useState(false)
  const [numbers, setNumbers] = useState(() => journalNumericDraft(existing))
  const [validationError, setValidationError] = useState<string>()
  useEffect(() => {
    setDraft(journalDraft(existing, date))
    setBaseline(existing && structuredClone(existing)); setTouched(new Set()); setBlocked(false)
    setNumbers(journalNumericDraft(existing))
    setValidationError(undefined)
  }, [date])
  if (!data) return null
  const updateNumber = (key: JournalNumericKey, raw: string) => {
    setTouched((current) => new Set([...current, key]))
    setNumbers((current) => ({ ...current, [key]: raw }))
    setValidationError(undefined)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const entry = applyJournalNumericDraft({ ...draft, date }, numbers)
      const changes: DailyFieldChange[] = [...touched].map((field) => entry[field] === undefined
        ? { field, action: 'CLEAR' } : { field, action: 'SET', value: entry[field]! })
      const result = await editDailyEntry({ date, newId: draft.id, baseline, changes })
      if (result.status !== 'APPLIED') { setValidationError(result.message); setBlocked(true); return }
      const saved = findDailyEntryByDate(result.snapshot.data.dailyEntries, date)
      setBaseline(saved && structuredClone(saved)); setDraft(journalDraft(saved, date)); setTouched(new Set())
      setNumbers(journalNumericDraft(saved))
      setValidationError(undefined)
    } catch (cause) {
      setValidationError(cause instanceof Error ? cause.message : 'Nieprawidłowa wartość liczbowa.')
    }
  }
  return (
    <main className="mobile-page"><p className="eyebrow">Codzienny check-in</p><h1>Dziennik</h1>
      <form className="mobile-form" onSubmit={submit}>
        <label className="mobile-field full"><span>Data</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <div className="form-grid">{fields.map(({ key, label, unit, integer }) => <label className="mobile-field" key={key}><span>{label}</span><div><input type="text" inputMode={integer ? 'numeric' : 'decimal'} value={numbers[key]} onChange={(event) => updateNumber(key, event.target.value)} placeholder="—" /><small>{unit}</small></div></label>)}</div>
        <label className="mobile-field full"><span>Notatki</span><textarea rows={4} value={draft.note ?? ''} onChange={(event) => { setTouched((current) => new Set([...current, 'note'])); setDraft((current) => ({ ...current, note: event.target.value || undefined })) }} placeholder="Jak minął dzień?" /></label>
        {validationError && <p className="pairing-error" role="alert">{validationError}</p>}
        <button className="primary-button" type="submit" disabled={saving || blocked || !touched.size}>{saving ? 'Zapisuję lokalnie…' : 'Zapisz Dziennik'}</button>
        <button type="button" className="secondary-button" disabled={saving} onClick={async () => {
          const fresh = await reload()
          if (!fresh) { setValidationError('Nie udało się odświeżyć wpisu.'); return }
          const entry = findDailyEntryByDate(fresh.data.dailyEntries,date)
          setDraft(journalDraft(entry,date)); setBaseline(entry && structuredClone(entry)); setNumbers(journalNumericDraft(entry)); setTouched(new Set()); setBlocked(false); setValidationError(undefined)
        }}>Odrzuć draft / wczytaj zapisany wpis</button><p className="safe-copy">Zapis trafia najpierw do lokalnego SQLite. Internet nie jest potrzebny.</p>
      </form>
    </main>
  )
}
