import { useMemo, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Edit3, Plus, Save, Trash2, X } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../context/AppContext'
import type { DailyEntry } from '../types'
import { formatLongDate, isoToday } from '../utils/date'
import { createId } from '../utils/id'

type NumericKey = 'weight' | 'calories' | 'protein' | 'fat' | 'steps' | 'waist' | 'sleep' | 'recovery'

const emptyEntry = (): DailyEntry => ({ id: createId(), date: isoToday() })

const fields: Array<{ key: NumericKey; label: string; unit?: string; step?: string; min?: number; max?: number; optional?: boolean }> = [
  { key: 'weight', label: 'Masa ciała', unit: 'kg', step: '0.1' },
  { key: 'calories', label: 'Kalorie', unit: 'kcal', step: '1' },
  { key: 'protein', label: 'Białko', unit: 'g', step: '1' },
  { key: 'fat', label: 'Tłuszcz', unit: 'g', step: '1', optional: true },
  { key: 'steps', label: 'Kroki', step: '1' },
  { key: 'waist', label: 'Talia', unit: 'cm', step: '0.1', optional: true },
  { key: 'sleep', label: 'Sen', unit: '/10', step: '0.1', min: 1, max: 10, optional: true },
  { key: 'recovery', label: 'Regeneracja', unit: '/10', step: '0.1', min: 1, max: 10, optional: true },
]

export function Journal() {
  const { data, upsertDailyEntry, deleteDailyEntry } = useApp()
  const [draft, setDraft] = useState<DailyEntry>(emptyEntry)
  const [editing, setEditing] = useState(false)
  const [sortNewest, setSortNewest] = useState(true)
  const [saved, setSaved] = useState(false)

  const sortedEntries = useMemo(() => [...data.dailyEntries].sort((a, b) =>
    sortNewest ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date),
  ), [data.dailyEntries, sortNewest])

  const setNumber = (key: NumericKey, value: string) => {
    setDraft((current) => ({ ...current, [key]: value === '' ? undefined : Number(value) }))
  }

  const reset = () => {
    setDraft(emptyEntry())
    setEditing(false)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    upsertDailyEntry({ ...draft, note: draft.note?.trim() || undefined })
    reset()
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2200)
  }

  const editEntry = (entry: DailyEntry) => {
    setDraft({ ...entry })
    setEditing(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const removeEntry = (entry: DailyEntry) => {
    if (window.confirm(`Usunąć wpis z ${formatLongDate(entry.date)}?`)) deleteDailyEntry(entry.id)
  }

  return (
    <div className="page journal-page">
      <PageHeader eyebrow="SZYBKI WPIS" title="Dziennik" description="Wpisz tylko to, co dziś zmierzyłeś. Puste pola nie liczą się do średnich." />

      <form className="card daily-form" onSubmit={submit}>
        <div className="form-heading">
          <div><span className="section-kicker">{editing ? 'EDYCJA WPISU' : 'NOWY WPIS'}</span><h2>{editing ? formatLongDate(draft.date) : 'Dane dnia'}</h2></div>
          {editing && <button type="button" className="button button--ghost button--small" onClick={reset}><X size={15} /> Anuluj</button>}
        </div>
        <div className="daily-form__grid">
          <label className="field field--date"><span>Data</span><input type="date" required value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /></label>
          {fields.map((field) => (
            <label className="field" key={field.key}>
              <span>{field.label} {field.optional && <em>opcjonalnie</em>}</span>
              <div className="input-with-unit">
                <input
                  type="number"
                  inputMode={field.step === '1' ? 'numeric' : 'decimal'}
                  step={field.step}
                  min={field.min ?? 0}
                  max={field.max}
                  placeholder="—"
                  value={draft[field.key] ?? ''}
                  onChange={(event) => setNumber(field.key, event.target.value)}
                />
                {field.unit && <span>{field.unit}</span>}
              </div>
            </label>
          ))}
        </div>
        <label className="field"><span>Notatka <em>opcjonalnie</em></span><textarea rows={2} placeholder="Np. gorszy sen, późny posiłek, dużo soli…" value={draft.note ?? ''} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label>
        <div className="form-footer">
          <p>{saved ? <span className="save-confirmation">Wpis zapisany lokalnie.</span> : 'Wpis z tą samą datą zastąpi wcześniejszy.'}</p>
          <button className="button button--primary" type="submit">{editing ? <Save size={17} /> : <Plus size={17} />} {editing ? 'Zapisz zmiany' : 'Dodaj wpis'}</button>
        </div>
      </form>

      <section className="card history-card">
        <div className="card-heading">
          <div><span className="section-kicker">HISTORIA</span><h2>Ostatnie wpisy <small>{data.dailyEntries.length}</small></h2></div>
          <button className="button button--ghost button--small" onClick={() => setSortNewest((current) => !current)}>
            Data {sortNewest ? <ArrowDown size={15} /> : <ArrowUp size={15} />}
          </button>
        </div>
        {sortedEntries.length ? (
          <div className="table-scroll">
            <table className="data-table journal-table">
              <thead><tr><th>Data</th><th>Masa</th><th>Kcal</th><th>Białko</th><th>Kroki</th><th>Talia</th><th>Sen</th><th>Reg.</th><th>Notatka</th><th aria-label="Akcje" /></tr></thead>
              <tbody>
                {sortedEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td><strong>{formatLongDate(entry.date)}</strong></td>
                    <td>{entry.weight !== undefined ? `${entry.weight.toLocaleString('pl-PL')} kg` : '—'}</td>
                    <td>{entry.calories?.toLocaleString('pl-PL') ?? '—'}</td>
                    <td>{entry.protein !== undefined ? `${entry.protein} g` : '—'}</td>
                    <td>{entry.steps?.toLocaleString('pl-PL') ?? '—'}</td>
                    <td>{entry.waist !== undefined ? `${entry.waist.toLocaleString('pl-PL')} cm` : '—'}</td>
                    <td>{entry.sleep !== undefined ? `${entry.sleep}/10` : '—'}</td>
                    <td>{entry.recovery !== undefined ? `${entry.recovery}/10` : '—'}</td>
                    <td className="note-cell" title={entry.note}>{entry.note || '—'}</td>
                    <td><div className="table-actions"><button className="icon-button" onClick={() => editEntry(entry)} aria-label="Edytuj"><Edit3 size={16} /></button><button className="icon-button icon-button--danger" onClick={() => removeEntry(entry)} aria-label="Usuń"><Trash2 size={16} /></button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="history-empty"><p>Nie masz jeszcze żadnych wpisów.</p><span>Pierwszy zapis pojawi się tutaj.</span></div>
        )}
      </section>
    </div>
  )
}
