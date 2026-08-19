import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  AlertTriangle,
  Check,
  Database,
  Download,
  Dumbbell,
  Edit3,
  FileJson,
  FileSpreadsheet,
  MapPin,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { DecimalInput } from '../components/DecimalInput'
import { TemplateEditor } from '../components/TemplateEditor'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { confirmAction, isDesktopApp, pickJsonText } from '../services/fileService'
import type { Phase, TrainingTemplate } from '../types'
import { phaseLabel } from '../utils/labels'
import { exportCsv, exportJson, normalizeData } from '../utils/storage'

const phases: Phase[] = ['Maintenance', 'Lean Gain', 'Mini Cut', 'Redukcja']

export function Settings() {
  const { data, updateSettings, updateTemplate, addGymLocation, renameGymLocation, deleteGymLocation, replaceData, clearData } = useApp()
  const { showToast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [newGymName, setNewGymName] = useState('')
  const [editingGym, setEditingGym] = useState<string | null>(null)
  const [gymNameDraft, setGymNameDraft] = useState('')
  const [editingTemplate, setEditingTemplate] = useState<TrainingTemplate | null>(null)
  const gymLocations = data.settings.gymLocations ?? []

  const hasGymName = (name: string, except?: string) => gymLocations.some((item) => (
    item !== except && item.localeCompare(name.trim(), 'pl', { sensitivity: 'accent' }) === 0
  ))

  const addGym = (event: FormEvent) => {
    event.preventDefault()
    const name = newGymName.trim()
    if (!name) return
    if (hasGymName(name)) {
      showToast('Taka siłownia jest już na liście', 'info')
      return
    }
    addGymLocation(name)
    setNewGymName('')
    showToast('Siłownia dodana')
  }

  const startGymRename = (name: string) => {
    setEditingGym(name)
    setGymNameDraft(name)
  }

  const saveGymRename = () => {
    const name = gymNameDraft.trim()
    if (!editingGym || !name) return
    if (hasGymName(name, editingGym)) {
      showToast('Taka siłownia jest już na liście', 'info')
      return
    }
    renameGymLocation(editingGym, name)
    setEditingGym(null)
    setGymNameDraft('')
    showToast('Nazwa siłowni zmieniona')
  }

  const removeGym = async (name: string) => {
    const confirmed = await confirmAction(`Usunąć „${name}” z listy siłowni? Nazwa pozostanie przy zapisanych wcześniej treningach.`, 'Usuń siłownię')
    if (!confirmed) return
    deleteGymLocation(name)
    showToast('Siłownia usunięta z listy', 'info')
  }

  const applyImportedText = async (contents: string) => {
    try {
      const imported = normalizeData(JSON.parse(contents))
      const confirmed = await confirmAction(`Import zastąpi obecne dane (${data.dailyEntries.length} wpisów i ${data.workouts.length} treningów). Ponowny import nie zostanie scalony z aktualnymi danymi. Kontynuować?`, 'Import kopii zapasowej GreekGod')
      if (!confirmed) return
      replaceData(imported)
      setMessage(null)
      showToast('Dane zaimportowane')
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Nie udało się odczytać pliku.', error: true })
    }
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await applyImportedText(await file.text())
  }

  const chooseImport = async () => {
    if (!isDesktopApp()) {
      inputRef.current?.click()
      return
    }
    const contents = await pickJsonText()
    if (contents) await applyImportedText(contents)
  }

  const resetAll = async () => {
    const confirmed = await confirmAction('Czy na pewno wyczyścić wszystkie wpisy, treningi i ustawienia? Tej operacji nie można cofnąć bez kopii JSON.', 'Wyczyść wszystkie dane')
    if (!confirmed) return
    clearData()
    setMessage(null)
    showToast('Wszystkie dane wyczyszczone', 'info')
  }

  const exportBackup = async () => {
    if (await exportJson(data)) showToast('Kopia zapasowa JSON zapisana')
  }

  const exportJournal = async () => {
    if (await exportCsv(data.dailyEntries)) showToast('Plik CSV zapisany')
  }

  return (
    <div className="page settings-page">
      <PageHeader eyebrow="LOKALNE USTAWIENIA" title="Ustawienia" description="Cele, kopie zapasowe i zarządzanie prywatnymi danymi GreekGod." />

      {message && <div className={`message-banner ${message.error ? 'message-banner--error' : ''}`}>{message.error ? <AlertTriangle size={18} /> : <Check size={18} />}{message.text}</div>}

      <div className="settings-grid">
        <section className="card settings-section">
          <div className="settings-section__heading"><span className="settings-icon"><RotateCcw size={19} /></span><div><h2>Aktualny cel</h2><p>Wartości widoczne w Panelu i raporcie.</p></div></div>
          <div className="settings-form">
            <label className="field"><span>Faza</span><select value={data.settings.phase} onChange={(event) => updateSettings({ phase: event.target.value as Phase })}>{phases.map((phase) => <option value={phase} key={phase}>{phaseLabel(phase)}</option>)}</select></label>
            <label className="field"><span>Cel kalorii</span><div className="input-with-unit"><input type="number" inputMode="numeric" min="0" value={data.settings.calorieTarget} onChange={(event) => updateSettings({ calorieTarget: Number(event.target.value) })} /><span>kcal</span></div></label>
            <label className="field"><span>Cel białka</span><div className="input-with-unit"><input type="number" inputMode="numeric" min="0" value={data.settings.proteinTarget} onChange={(event) => updateSettings({ proteinTarget: Number(event.target.value) })} /><span>g</span></div></label>
            <label className="field"><span>Cel masy <em>opcjonalnie</em></span><div className="input-with-unit"><DecimalInput min={0} placeholder="Brak" value={data.settings.weightTarget} onValueChange={(value) => updateSettings({ weightTarget: value })} /><span>kg</span></div></label>
          </div>
          <div className="threshold-settings">
            <div><span className="section-kicker">STATUS TYGODNIOWY</span><h3>Progi trendu masy</h3><p>Granice służą wyłącznie do opisania trendu, bez rekomendacji.</p></div>
            <div className="settings-form settings-form--thresholds">
              <label className="field"><span>Spadek poniżej</span><div className="input-with-unit"><DecimalInput value={data.settings.trendThresholds.lossBelow} onValueChange={(value) => value !== undefined && updateSettings({ trendThresholds: { ...data.settings.trendThresholds, lossBelow: value } })} /><span>kg</span></div></label>
              <label className="field"><span>Stabilna do</span><div className="input-with-unit"><DecimalInput value={data.settings.trendThresholds.stableUpper} onValueChange={(value) => value !== undefined && updateSettings({ trendThresholds: { ...data.settings.trendThresholds, stableUpper: value } })} /><span>kg</span></div></label>
              <label className="field"><span>Powolny wzrost do</span><div className="input-with-unit"><DecimalInput value={data.settings.trendThresholds.slowGainUpper} onValueChange={(value) => value !== undefined && updateSettings({ trendThresholds: { ...data.settings.trendThresholds, slowGainUpper: value } })} /><span>kg</span></div></label>
            </div>
          </div>
        </section>

        <section className="card settings-section gym-settings">
          <div className="settings-section__heading"><span className="settings-icon"><MapPin size={19} /></span><div><h2>Moje siłownie</h2><p>Ręcznie zapisane lokalizacje pomagają poprawnie porównywać wyniki na maszynach.</p></div></div>
          <form className="gym-add-form" onSubmit={addGym}>
            <label className="field"><span>Nazwa siłowni</span><input type="text" maxLength={80} placeholder="Np. CityFit Centrum" value={newGymName} onChange={(event) => setNewGymName(event.target.value)} /></label>
            <button className="button button--primary" type="submit" disabled={!newGymName.trim()}><Plus size={16} /> Dodaj</button>
          </form>
          {gymLocations.length ? <div className="gym-location-list">{gymLocations.map((name) => <div className="gym-location-row" key={name}>
            {editingGym === name ? <>
              <MapPin size={17} />
              <input autoFocus type="text" maxLength={80} aria-label={`Nowa nazwa siłowni ${name}`} value={gymNameDraft} onChange={(event) => setGymNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveGymRename(); if (event.key === 'Escape') setEditingGym(null) }} />
              <button type="button" className="button button--small button--primary" onClick={saveGymRename}>Zapisz</button>
              <button type="button" className="icon-button" onClick={() => setEditingGym(null)} aria-label="Anuluj zmianę nazwy"><X size={16} /></button>
            </> : <>
              <MapPin size={17} /><strong>{name}</strong>
              <button type="button" className="icon-button" onClick={() => startGymRename(name)} aria-label={`Zmień nazwę siłowni ${name}`}><Edit3 size={16} /></button>
              <button type="button" className="icon-button icon-button--danger" onClick={() => void removeGym(name)} aria-label={`Usuń siłownię ${name}`}><Trash2 size={16} /></button>
            </>}
          </div>)}</div> : <p className="gym-location-empty">Nie dodano jeszcze żadnej siłowni.</p>}
        </section>

        <section className="card settings-section template-settings">
          <div className="settings-section__heading"><span className="settings-icon"><Dumbbell size={19} /></span><div><h2>Szablony treningowe</h2><p>Trwałe zmiany będą używane w przyszłych treningach. Zapisana historia nie zostanie zmieniona.</p></div></div>
          <div className="template-settings__list">{data.templates.map((template) => <div className="template-settings__row" key={template.id}><span className="template-code">{template.code}</span><div><strong>{template.name}</strong><small>{template.exercises.length} ćwiczeń</small></div><button type="button" className="button button--secondary button--small" onClick={() => setEditingTemplate(template)}><Edit3 size={15} /> Edytuj szablon</button></div>)}</div>
        </section>

        <section className="card settings-section">
          <div className="settings-section__heading"><span className="settings-icon"><Database size={19} /></span><div><h2>Twoje dane</h2><p>{data.dailyEntries.length} wpisów dziennika · {data.workouts.length} treningów</p></div></div>
          <div className="data-summary">
            <div><FileJson size={20} /><span><strong>Pełna kopia JSON</strong><small>Wpisy, treningi, cele i szablony</small></span></div>
            <button className="button button--secondary" onClick={exportBackup}><Download size={16} /> Eksportuj JSON</button>
          </div>
          <div className="data-summary">
            <div><Upload size={20} /><span><strong>Przywróć kopię</strong><small>Zastąpi aktualne dane zawartością JSON</small></span></div>
            <button className="button button--secondary" onClick={chooseImport}><Upload size={16} /> Importuj JSON</button>
            <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={importFile} />
          </div>
          <div className="data-summary">
            <div><FileSpreadsheet size={20} /><span><strong>Dziennik CSV</strong><small>Podstawowe dane do arkusza</small></span></div>
            <button className="button button--secondary" disabled={!data.dailyEntries.length} onClick={exportJournal}><Download size={16} /> Eksportuj CSV</button>
          </div>
        </section>

        <section className="card privacy-card">
          <ShieldCheck size={22} />
          <div><h2>Prywatnie i lokalnie</h2><p>{isDesktopApp() ? 'Dane są przechowywane w prywatnym, lokalnym pliku aplikacji na tym komputerze.' : 'Wersja przeglądarkowa przechowuje dane w pamięci tej przeglądarki.'} Nie są wysyłane do chmury ani na żaden serwer. Regularnie eksportuj pełną kopię JSON.</p></div>
        </section>

        <section className="card danger-card">
          <div><h2>Wyczyść wszystkie dane</h2><p>Usuwa wpisy dziennika, treningi oraz przywraca domyślne cele. Operacja jest nieodwracalna bez kopii.</p></div>
          <button className="button button--danger" onClick={resetAll}><Trash2 size={16} /> Wyczyść dane</button>
        </section>
      </div>
      {editingTemplate && <TemplateEditor template={editingTemplate} onSave={(template) => { updateTemplate(template); showToast('Szablon zapisany') }} onClose={() => setEditingTemplate(null)} />}
    </div>
  )
}
