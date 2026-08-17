import { useRef, useState, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  Check,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../context/AppContext'
import type { Phase } from '../types'
import { exportCsv, exportJson, normalizeData } from '../utils/storage'

const phases: Phase[] = ['Maintenance', 'Lean Gain', 'Mini Cut', 'Redukcja']

export function Settings() {
  const { data, updateSettings, replaceData, clearData } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const imported = normalizeData(JSON.parse(await file.text()))
      if (!window.confirm(`Import zastąpi obecne dane (${data.dailyEntries.length} wpisów i ${data.workouts.length} treningów). Kontynuować?`)) return
      replaceData(imported)
      setMessage({ text: 'Kopia danych została zaimportowana.' })
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Nie udało się odczytać pliku.', error: true })
    }
  }

  const resetAll = () => {
    if (!window.confirm('Czy na pewno wyczyścić wszystkie wpisy, treningi i ustawienia? Tej operacji nie można cofnąć bez kopii JSON.')) return
    clearData()
    setMessage({ text: 'Wszystkie dane zostały wyczyszczone.' })
  }

  return (
    <div className="page settings-page">
      <PageHeader eyebrow="LOKALNE USTAWIENIA" title="Ustawienia" description="Cele, kopie zapasowe i zarządzanie danymi tej przeglądarki." />

      {message && <div className={`message-banner ${message.error ? 'message-banner--error' : ''}`}>{message.error ? <AlertTriangle size={18} /> : <Check size={18} />}{message.text}</div>}

      <div className="settings-grid">
        <section className="card settings-section">
          <div className="settings-section__heading"><span className="settings-icon"><RotateCcw size={19} /></span><div><h2>Aktualny cel</h2><p>Wartości widoczne na Dashboardzie i w raporcie.</p></div></div>
          <div className="settings-form">
            <label className="field"><span>Faza</span><select value={data.settings.phase} onChange={(event) => updateSettings({ phase: event.target.value as Phase })}>{phases.map((phase) => <option key={phase}>{phase}</option>)}</select></label>
            <label className="field"><span>Cel kalorii</span><div className="input-with-unit"><input type="number" inputMode="numeric" min="0" value={data.settings.calorieTarget} onChange={(event) => updateSettings({ calorieTarget: Number(event.target.value) })} /><span>kcal</span></div></label>
            <label className="field"><span>Cel białka</span><div className="input-with-unit"><input type="number" inputMode="numeric" min="0" value={data.settings.proteinTarget} onChange={(event) => updateSettings({ proteinTarget: Number(event.target.value) })} /><span>g</span></div></label>
            <label className="field"><span>Cel masy <em>opcjonalnie</em></span><div className="input-with-unit"><input type="number" inputMode="decimal" min="0" step="0.1" placeholder="Brak" value={data.settings.weightTarget ?? ''} onChange={(event) => updateSettings({ weightTarget: event.target.value === '' ? undefined : Number(event.target.value) })} /><span>kg</span></div></label>
          </div>
        </section>

        <section className="card settings-section">
          <div className="settings-section__heading"><span className="settings-icon"><Database size={19} /></span><div><h2>Twoje dane</h2><p>{data.dailyEntries.length} wpisów dziennika · {data.workouts.length} treningów</p></div></div>
          <div className="data-summary">
            <div><FileJson size={20} /><span><strong>Pełna kopia JSON</strong><small>Wpisy, treningi, cele i szablony</small></span></div>
            <button className="button button--secondary" onClick={() => exportJson(data)}><Download size={16} /> Eksportuj JSON</button>
          </div>
          <div className="data-summary">
            <div><Upload size={20} /><span><strong>Przywróć kopię</strong><small>Zastąpi aktualne dane zawartością JSON</small></span></div>
            <button className="button button--secondary" onClick={() => inputRef.current?.click()}><Upload size={16} /> Importuj JSON</button>
            <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={importFile} />
          </div>
          <div className="data-summary">
            <div><FileSpreadsheet size={20} /><span><strong>Dziennik CSV</strong><small>Podstawowe dane do arkusza</small></span></div>
            <button className="button button--secondary" disabled={!data.dailyEntries.length} onClick={() => exportCsv(data.dailyEntries)}><Download size={16} /> Eksportuj CSV</button>
          </div>
        </section>

        <section className="card privacy-card">
          <ShieldCheck size={22} />
          <div><h2>Prywatnie i lokalnie</h2><p>Dane są przechowywane w localStorage tej przeglądarki. Nie są wysyłane do chmury ani na żaden serwer. Regularnie eksportuj kopię JSON, zwłaszcza przed czyszczeniem danych przeglądarki.</p></div>
        </section>

        <section className="card danger-card">
          <div><h2>Wyczyść wszystkie dane</h2><p>Usuwa wpisy dziennika, treningi oraz przywraca domyślne cele. Operacja jest nieodwracalna bez kopii.</p></div>
          <button className="button button--danger" onClick={resetAll}><Trash2 size={16} /> Wyczyść dane</button>
        </section>
      </div>
    </div>
  )
}
