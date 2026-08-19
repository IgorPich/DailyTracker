import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from 'lucide-react'
import { confirmAction } from '../services/fileService'
import type { TemplateExercise, TrainingTemplate } from '../types'
import { createId } from '../utils/id'
import { moveExercise } from '../utils/workoutData'
import { prescriptionRepRange } from '../utils/workoutProgress'

const rangeFor = (exercise: TemplateExercise) => prescriptionRepRange(exercise.prescription) ?? { min: 6, max: 10 }
const prescriptionFor = (sets: number, min: number, max: number) => `${sets} × ${min}–${max}`

export function TemplateEditor({ template, initialExerciseId, onSave, onClose }: {
  template: TrainingTemplate
  initialExerciseId?: string
  onSave: (template: TrainingTemplate) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<TrainingTemplate>(() => structuredClone(template))
  const [newName, setNewName] = useState('')
  const [newSets, setNewSets] = useState(3)
  const [newMin, setNewMin] = useState(8)
  const [newMax, setNewMax] = useState(12)
  const [newPosition, setNewPosition] = useState(template.exercises.length + 1)
  const [newSensitive, setNewSensitive] = useState(false)

  const updateExercise = (id: string, updates: Partial<TemplateExercise>) => setDraft((current) => ({
    ...current,
    exercises: current.exercises.map((exercise) => exercise.id === id ? { ...exercise, ...updates } : exercise),
  }))

  const updateSets = (exercise: TemplateExercise, value: number) => {
    const defaultSets = Math.max(1, Math.round(value || 1))
    const range = rangeFor(exercise)
    updateExercise(exercise.id, { defaultSets, prescription: prescriptionFor(defaultSets, range.min, range.max) })
  }

  const updateRange = (exercise: TemplateExercise, key: 'min' | 'max', value: number) => {
    const range = rangeFor(exercise)
    const next = { ...range, [key]: Math.max(1, Math.round(value || 1)) }
    updateExercise(exercise.id, { prescription: prescriptionFor(exercise.defaultSets, next.min, next.max) })
  }

  const reorder = (id: string, direction: -1 | 1) => setDraft((current) => {
    const index = current.exercises.findIndex((exercise) => exercise.id === id)
    return { ...current, exercises: moveExercise(current.exercises, index, index + direction) }
  })

  const remove = async (exercise: TemplateExercise) => {
    const confirmed = await confirmAction(
      `Usunąć „${exercise.name}” z przyszłych treningów ${draft.name}? Zapisane wcześniejsze treningi nie zostaną zmienione.`,
      'Usuń ćwiczenie z szablonu',
    )
    if (confirmed) setDraft((current) => ({ ...current, exercises: current.exercises.filter((item) => item.id !== exercise.id) }))
  }

  const addExercise = () => {
    const name = newName.trim()
    if (!name) return
    if (newMin > newMax) {
      window.alert('Dolny zakres powtórzeń nie może być większy od górnego.')
      return
    }
    const safePosition = Number.isFinite(newPosition) ? newPosition : draft.exercises.length + 1
    const exercise: TemplateExercise = {
      id: `custom-${createId()}`,
      name,
      defaultSets: Math.max(1, Math.round(newSets)),
      prescription: prescriptionFor(Math.max(1, Math.round(newSets)), Math.max(1, Math.round(newMin)), Math.max(1, Math.round(newMax))),
      ...(newSensitive ? { equipmentSensitive: true } : {}),
    }
    setDraft((current) => {
      const exercises = [...current.exercises]
      exercises.splice(Math.max(0, Math.min(exercises.length, safePosition - 1)), 0, exercise)
      return { ...current, exercises }
    })
    setNewName('')
    setNewPosition(draft.exercises.length + 2)
  }

  const save = () => {
    if (!draft.exercises.length) {
      window.alert('Szablon musi zawierać przynajmniej jedno ćwiczenie.')
      return
    }
    if (draft.exercises.some((exercise) => !exercise.name.trim())) {
      window.alert('Każde ćwiczenie musi mieć nazwę.')
      return
    }
    if (draft.exercises.some((exercise) => {
      const range = rangeFor(exercise)
      return range.min > range.max
    })) {
      window.alert('Dolny zakres powtórzeń nie może być większy od górnego.')
      return
    }
    onSave({ ...draft, exercises: draft.exercises.map((exercise) => ({ ...exercise, name: exercise.name.trim() })) })
    onClose()
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="modal card template-editor-modal" role="dialog" aria-modal="true" aria-label={`Edycja szablonu ${template.name}`} onMouseDown={(event) => event.stopPropagation()}>
      <header className="template-editor__header"><div><span className="section-kicker">TRWAŁA EDYCJA</span><h2>{draft.code} — {draft.name}</h2><p>Zmiany obejmą wyłącznie przyszłe treningi. Historia pozostanie bez zmian.</p></div><button className="icon-button" onClick={onClose} aria-label="Zamknij"><X size={20} /></button></header>

      <div className="template-editor__list">{draft.exercises.map((exercise, index) => {
        const range = rangeFor(exercise)
        return <article className={`template-editor__exercise ${exercise.id === initialExerciseId ? 'template-editor__exercise--focus' : ''}`} key={exercise.id}>
          <span className="template-editor__index">{String(index + 1).padStart(2, '0')}</span>
          <label className="field template-editor__name"><span>Nazwa ćwiczenia</span><input type="text" value={exercise.name} onChange={(event) => updateExercise(exercise.id, { name: event.target.value })} /></label>
          <label className="field"><span>Serie</span><input type="number" min="1" max="20" value={exercise.defaultSets} onChange={(event) => updateSets(exercise, Number(event.target.value))} /></label>
          <label className="field"><span>Powt. od</span><input type="number" min="1" max="100" value={range.min} onChange={(event) => updateRange(exercise, 'min', Number(event.target.value))} /></label>
          <label className="field"><span>Powt. do</span><input type="number" min="1" max="100" value={range.max} onChange={(event) => updateRange(exercise, 'max', Number(event.target.value))} /></label>
          <label className="checkbox-field template-editor__sensitive"><input type="checkbox" checked={Boolean(exercise.equipmentSensitive)} onChange={(event) => updateExercise(exercise.id, { equipmentSensitive: event.target.checked })} /><span>Wynik zależy od maszyny / siłowni</span></label>
          <div className="template-editor__actions"><button type="button" className="icon-button" disabled={index === 0} onClick={() => reorder(exercise.id, -1)} aria-label="Przenieś wyżej"><ArrowUp size={16} /></button><button type="button" className="icon-button" disabled={index === draft.exercises.length - 1} onClick={() => reorder(exercise.id, 1)} aria-label="Przenieś niżej"><ArrowDown size={16} /></button><button type="button" className="icon-button icon-button--danger" onClick={() => void remove(exercise)} aria-label="Usuń z szablonu"><Trash2 size={16} /></button></div>
        </article>
      })}</div>

      <section className="template-editor__add"><div><span className="section-kicker">NOWE ĆWICZENIE</span><h3>Dodaj ćwiczenie do szablonu</h3></div><div className="template-editor__add-grid"><label className="field"><span>Nazwa</span><input type="text" placeholder="Np. wiosło jednorącz" value={newName} onChange={(event) => setNewName(event.target.value)} /></label><label className="field"><span>Serie</span><input type="number" min="1" max="20" value={newSets} onChange={(event) => setNewSets(Number(event.target.value))} /></label><label className="field"><span>Powt. od</span><input type="number" min="1" max="100" value={newMin} onChange={(event) => setNewMin(Number(event.target.value))} /></label><label className="field"><span>Powt. do</span><input type="number" min="1" max="100" value={newMax} onChange={(event) => setNewMax(Number(event.target.value))} /></label><label className="field"><span>Pozycja</span><input type="number" min="1" max={draft.exercises.length + 1} value={newPosition} onChange={(event) => setNewPosition(Number(event.target.value))} /></label></div><label className="checkbox-field"><input type="checkbox" checked={newSensitive} onChange={(event) => setNewSensitive(event.target.checked)} /><span>Wynik zależy od maszyny / siłowni</span></label><button type="button" className="button button--secondary" disabled={!newName.trim()} onClick={addExercise}><Plus size={16} /> Dodaj do {draft.name}</button></section>

      <footer className="template-editor__footer"><button type="button" className="button button--ghost" onClick={onClose}><X size={16} /> Anuluj</button><button type="button" className="button button--primary" onClick={save}><Save size={16} /> Zapisz szablon</button></footer>
    </section>
  </div>
}
