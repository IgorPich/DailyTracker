import { useEffect, useState, type FormEvent } from 'react'
import { findDailyEntryByDate, normalizeDecimalInput, upsertDailyEntry, type DailyEntry } from '@greekgod/core'
import { useMobileData } from '../context/MobileDataContext'
import { isoToday, journalDraft } from '../domain/mobileModel'

type NumericKey = 'weight' | 'waist' | 'calories' | 'protein' | 'carbs' | 'fat' | 'steps'
const fields: Array<{ key: NumericKey; label: string; unit: string; integer?: boolean }> = [
  { key: 'weight', label: 'Waga', unit: 'kg' }, { key: 'waist', label: 'Talia', unit: 'cm' },
  { key: 'calories', label: 'Kalorie', unit: 'kcal', integer: true }, { key: 'protein', label: 'Białko', unit: 'g', integer: true },
  { key: 'carbs', label: 'Węglowodany', unit: 'g', integer: true }, { key: 'fat', label: 'Tłuszcze', unit: 'g', integer: true },
  { key: 'steps', label: 'Kroki', unit: '', integer: true },
]

export const JournalPage = () => {
  const { data, mutate, saving } = useMobileData()
  const [date, setDate] = useState(isoToday())
  const existing = data ? findDailyEntryByDate(data.dailyEntries, date) : undefined
  const [draft, setDraft] = useState<DailyEntry>(() => journalDraft(existing, date))
  useEffect(() => setDraft(journalDraft(existing, date)), [existing?.id, date])
  if (!data) return null
  const updateNumber = (key: NumericKey, raw: string) => setDraft((current) => ({ ...current, [key]: normalizeDecimalInput(raw) }))
  const submit = async (event: FormEvent) => { event.preventDefault(); await mutate((current) => ({ ...current, dailyEntries: upsertDailyEntry(current.dailyEntries, { ...draft, date }) })) }
  return (
    <main className="mobile-page"><p className="eyebrow">Codzienny check-in</p><h1>Dziennik</h1>
      <form className="mobile-form" onSubmit={submit}>
        <label className="mobile-field full"><span>Data</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <div className="form-grid">{fields.map(({ key, label, unit, integer }) => <label className="mobile-field" key={key}><span>{label}</span><div><input inputMode={integer ? 'numeric' : 'decimal'} value={draft[key] ?? ''} onChange={(event) => updateNumber(key, event.target.value)} placeholder="—" /><small>{unit}</small></div></label>)}</div>
        <label className="mobile-field full"><span>Notatki</span><textarea rows={4} value={draft.note ?? ''} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value || undefined }))} placeholder="Jak minął dzień?" /></label>
        <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Zapisuję lokalnie…' : 'Zapisz Dziennik'}</button><p className="safe-copy">Zapis trafia najpierw do lokalnego SQLite. Internet nie jest potrzebny.</p>
      </form>
    </main>
  )
}
