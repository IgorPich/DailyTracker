import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  History,
  MapPin,
  MoreHorizontal,
  NotebookPen,
  Play,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageHeader } from '../components/PageHeader'
import { DecimalInput } from '../components/DecimalInput'
import { TemplateEditor } from '../components/TemplateEditor'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { confirmAction } from '../services/fileService'
import type { TemplateExercise, TrainingTemplate, Workout, WorkoutExercise, WorkoutSet } from '../types'
import { formatLongDate, isoToday } from '../utils/date'
import { createId } from '../utils/id'
import { formatDecimal } from '../utils/numbers'
import { exercisesMatch, moveExercise, previousExerciseOccurrence } from '../utils/workoutData'
import { compareSets, equipmentComparisonIssue, formatGymName, formatSet, getBestSet, isEquipmentSensitive } from '../utils/workoutProgress'

const emptySet = (): WorkoutSet => ({ id: createId() })
const fromTemplateExercise = (item: TemplateExercise): WorkoutExercise => ({
  id: item.id,
  name: item.name,
  prescription: item.prescription,
  sets: Array.from({ length: item.defaultSets }, emptySet),
  equipmentSensitive: item.equipmentSensitive,
})
const cloneWorkout = (workout: Workout): Workout => structuredClone(workout)
const hasVisibleValue = (set: WorkoutSet) => set.weight !== undefined || set.reps !== undefined
const hasStoredValue = (set: WorkoutSet) => hasVisibleValue(set) || set.rir !== undefined

export function Training({ openWorkoutId, onWorkoutOpened }: { openWorkoutId?: string; onWorkoutOpened?: () => void }) {
  const { data, addWorkout, updateWorkout, deleteWorkout, updateSettings, updateTemplate } = useApp()
  const { showToast } = useToast()
  const lastWorkout = [...data.workouts].sort((a, b) => b.date.localeCompare(a.date))[0]
  const lastIndex = lastWorkout ? data.templates.findIndex((template) => template.id === lastWorkout.templateId) : -1
  const suggested = data.templates[(lastIndex + 1 + data.templates.length) % data.templates.length] ?? data.templates[0]
  const [selectedId, setSelectedId] = useState(suggested.id)
  const selected = data.templates.find((template) => template.id === selectedId) ?? data.templates[0]
  const [date, setDate] = useState(isoToday())
  const [duration, setDuration] = useState<number | undefined>()
  const savedGymLocations = data.settings.gymLocations ?? []
  const initialGymLocation = data.settings.lastGymLocation && savedGymLocations.includes(data.settings.lastGymLocation) ? data.settings.lastGymLocation : ''
  const [gymLocation, setGymLocation] = useState(initialGymLocation)
  const [note, setNote] = useState('')
  const [exercises, setExercises] = useState<WorkoutExercise[]>(() => selected.exercises.map(fromTemplateExercise))
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selected.exercises.map((item) => item.id)))
  const [noteOpen, setNoteOpen] = useState<Set<string>>(new Set())
  const [exerciseMenu, setExerciseMenu] = useState<string | null>(null)
  const [historyExercise, setHistoryExercise] = useState<WorkoutExercise | null>(null)
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null)
  const [addingCustom, setAddingCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customEquipmentSensitive, setCustomEquipmentSensitive] = useState(false)
  const [renamingExerciseId, setRenamingExerciseId] = useState<string | null>(null)
  const [exerciseNameDraft, setExerciseNameDraft] = useState('')
  const [templateEditorTarget, setTemplateEditorTarget] = useState<{ templateId: string; exerciseId?: string } | null>(null)

  useEffect(() => {
    if (openWorkoutId && data.workouts.some((workout) => workout.id === openWorkoutId)) {
      setSelectedWorkoutId(openWorkoutId)
      onWorkoutOpened?.()
    }
  }, [openWorkoutId, data.workouts, onWorkoutOpened])

  const previousFor = (exercise: WorkoutExercise) => previousExerciseOccurrence(data.workouts, exercise, date, gymLocation, isEquipmentSensitive)

  const selectTemplate = (template: TrainingTemplate) => {
    const hasValues = exercises.some((exercise) => exercise.sets.some(hasVisibleValue))
    if (hasValues && !window.confirm('Zmiana planu wyczyści wpisane serie. Kontynuować?')) return
    setSelectedId(template.id)
    setExercises(template.exercises.map(fromTemplateExercise))
    setExpanded(new Set(template.exercises.map((item) => item.id)))
    setNoteOpen(new Set())
    setRenamingExerciseId(null)
    setExerciseMenu(null)
  }

  const updateSet = (exerciseId: string, setId: string, key: 'weight' | 'reps', value: number | undefined) => setExercises((current) => current.map((exercise) => exercise.id !== exerciseId ? exercise : {
    ...exercise,
    sets: exercise.sets.map((set) => set.id !== setId ? set : { ...set, [key]: value }),
  }))

  const updateExerciseNote = (exerciseId: string, value: string) => setExercises((current) => current.map((exercise) => exercise.id === exerciseId ? { ...exercise, note: value } : exercise))
  const addSet = (exerciseId: string) => setExercises((current) => current.map((exercise) => exercise.id === exerciseId ? { ...exercise, sets: [...exercise.sets, emptySet()] } : exercise))
  const removeSet = (exerciseId: string, setId: string) => setExercises((current) => current.map((exercise) => exercise.id === exerciseId ? { ...exercise, sets: exercise.sets.filter((set) => set.id !== setId) } : exercise))
  const toggleSkip = (exerciseId: string) => setExercises((current) => current.map((exercise) => exercise.id === exerciseId ? { ...exercise, skipped: !exercise.skipped } : exercise))

  const toggleExpanded = (exerciseId: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(exerciseId)) next.delete(exerciseId)
    else next.add(exerciseId)
    return next
  })

  const toggleNote = (exerciseId: string) => setNoteOpen((current) => {
    const next = new Set(current)
    if (next.has(exerciseId)) next.delete(exerciseId)
    else next.add(exerciseId)
    return next
  })

  const reorderExercise = (exerciseId: string, direction: -1 | 1) => {
    setExercises((current) => {
      const index = current.findIndex((exercise) => exercise.id === exerciseId)
      return moveExercise(current, index, index + direction)
    })
    setExerciseMenu(null)
  }

  const beginExerciseRename = (exercise: WorkoutExercise) => {
    setRenamingExerciseId(exercise.id)
    setExerciseNameDraft(exercise.name)
    setExerciseMenu(null)
  }

  const cancelExerciseRename = () => {
    setRenamingExerciseId(null)
    setExerciseNameDraft('')
  }

  const saveExerciseRename = (exerciseId: string) => {
    const name = exerciseNameDraft.trim()
    if (!name) return
    setExercises((current) => current.map((exercise) => exercise.id === exerciseId ? { ...exercise, name } : exercise))
    cancelExerciseRename()
  }

  const toggleEquipmentSensitivity = (exerciseId: string) => {
    setExercises((current) => current.map((exercise) => exercise.id === exerciseId
      ? { ...exercise, equipmentSensitive: !isEquipmentSensitive(exercise) }
      : exercise))
    setExerciseMenu(null)
  }

  const fillPrevious = () => {
    setExercises((current) => current.map((exercise) => {
      const previous = previousFor(exercise).comparable?.exercise
      if (!previous) return exercise
      const setCount = Math.max(exercise.sets.length, previous.sets.length)
      return {
        ...exercise,
        sets: Array.from({ length: setCount }, (_, index) => ({
          id: exercise.sets[index]?.id ?? createId(),
          weight: previous.sets[index]?.weight,
          reps: exercise.sets[index]?.reps,
        })),
      }
    }))
    showToast('Wpisano poprzednie ciężary', 'info')
  }

  const addCustomExercise = () => {
    const name = customName.trim()
    if (!name) return
    const id = `custom-${createId()}`
    setExercises((current) => [...current, {
      id,
      name,
      prescription: 'Własne ćwiczenie',
      sets: [emptySet(), emptySet(), emptySet()],
      isCustom: true,
      ...(customEquipmentSensitive ? { equipmentSensitive: true } : {}),
    }])
    setExpanded((current) => new Set(current).add(id))
    setCustomName('')
    setCustomEquipmentSensitive(false)
    setAddingCustom(false)
  }

  const saveWorkout = (event: FormEvent) => {
    event.preventDefault()
    const completed = exercises.map((exercise) => ({
      ...exercise,
      note: exercise.note?.trim() || undefined,
      sets: exercise.sets.filter(hasVisibleValue),
    }))
    if (!completed.some((exercise) => !exercise.skipped && exercise.sets.length)) {
      window.alert('Wpisz przynajmniej jedną serię przed zapisaniem treningu.')
      return
    }
    addWorkout({
      id: createId(),
      date,
      templateId: selected.id,
      templateCode: selected.code,
      templateName: selected.name,
      exercises: completed,
      duration,
      gymLocation: gymLocation.trim() || undefined,
      note: note.trim() || undefined,
    })
    updateSettings({ lastGymLocation: gymLocation.trim() || undefined })
    setExercises(selected.exercises.map(fromTemplateExercise))
    setExpanded(new Set(selected.exercises.map((item) => item.id)))
    setDuration(undefined)
    setNote('')
    showToast('Trening zapisany')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const selectedWorkout = data.workouts.find((workout) => workout.id === selectedWorkoutId)

  return (
    <div className="page training-page training-v2">
      <PageHeader eyebrow="CYKL TRENINGOWY" title="Trening" description={lastWorkout ? `Ostatnio: ${lastWorkout.templateCode} · ${lastWorkout.templateName}, ${formatLongDate(lastWorkout.date)}` : 'Wybierz plan i zacznij zapisywać serie.'} />

      <section className="template-picker" aria-label="Wybierz trening">{data.templates.map((template) => <button key={template.id} className={selected.id === template.id ? 'active' : ''} onClick={() => selectTemplate(template)}><span>{template.code}</span><div><strong>{template.name}</strong><small>{template.exercises.length} ćwiczeń</small></div>{suggested.id === template.id && <em>SUGEROWANY</em>}</button>)}</section>

      <form onSubmit={saveWorkout}>
        <section className="card workout-meta workout-meta-v2">
          <div className="workout-meta__title"><span className="template-code">{selected.code}</span><div><span className="section-kicker">AKTYWNY TRENING</span><h2>{selected.name}</h2></div></div>
          <button type="button" className="button button--ghost autofill-button" onClick={fillPrevious}><Copy size={16} /> Wypełnij poprzednimi ciężarami</button>
          <label className="field"><span>Data</span><input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="field"><span>Siłownia <em>opcjonalnie</em></span><select value={gymLocation} onChange={(event) => { setGymLocation(event.target.value); updateSettings({ lastGymLocation: event.target.value || undefined }) }}><option value="">Nie podano</option>{savedGymLocations.map((location) => <option value={location} key={location}>{location}</option>)}</select></label>
          <label className="field"><span>Czas <em>opcjonalnie</em></span><div className="input-with-unit"><input type="number" inputMode="numeric" min="1" placeholder="—" value={duration ?? ''} onChange={(event) => setDuration(event.target.value === '' ? undefined : Number(event.target.value))} /><span>min</span></div></label>
        </section>

        <div className="exercise-list">{exercises.map((exercise, exerciseIndex) => {
          const previousInfo = previousFor(exercise)
          const previous = previousInfo.comparable
          const latest = previousInfo.latest
          const comparisonIssue = !previous && latest
            ? equipmentComparisonIssue(exercise, latest.exercise, gymLocation, latest.workout.gymLocation)
            : undefined
          const isExpanded = expanded.has(exercise.id)
          return <article className={`card exercise-card ${exercise.skipped ? 'exercise-card--skipped' : ''}`} key={exercise.id}>
            <header className="exercise-card__header">
              {renamingExerciseId === exercise.id ? <div className="exercise-title exercise-title--editing">
                <span>{String(exerciseIndex + 1).padStart(2, '0')}</span>
                <div className="exercise-rename"><input autoFocus type="text" aria-label="Nowa nazwa ćwiczenia" value={exerciseNameDraft} onChange={(event) => setExerciseNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveExerciseRename(exercise.id) }; if (event.key === 'Escape') cancelExerciseRename() }} /><span><button type="button" onClick={() => saveExerciseRename(exercise.id)}>Zapisz</button><button type="button" onClick={cancelExerciseRename}>Anuluj</button></span></div>
              </div> : <button type="button" className="exercise-title" onClick={() => toggleExpanded(exercise.id)} aria-expanded={isExpanded}>
                <span>{String(exerciseIndex + 1).padStart(2, '0')}</span>
                <div><strong>{exercise.name}</strong><small>{exercise.prescription}</small></div>
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>}
              <div className="exercise-menu-wrap">
                <button type="button" className="icon-button exercise-more" onClick={() => setExerciseMenu((current) => current === exercise.id ? null : exercise.id)} aria-label={`Menu ćwiczenia ${exercise.name}`} aria-expanded={exerciseMenu === exercise.id}><MoreHorizontal size={19} /></button>
                {exerciseMenu === exercise.id && <div className="exercise-menu">
                  <button type="button" onClick={() => beginExerciseRename(exercise)}><Edit3 size={15} /> Edytuj w tym treningu</button>
                  {!exercise.isCustom && <button type="button" onClick={() => { setTemplateEditorTarget({ templateId: selected.id, exerciseId: exercise.id }); setExerciseMenu(null) }}><Save size={15} /> Edytuj szablon</button>}
                  <button type="button" disabled={exerciseIndex === 0} onClick={() => reorderExercise(exercise.id, -1)}><ArrowUp size={15} /> Przenieś wyżej</button>
                  <button type="button" disabled={exerciseIndex === exercises.length - 1} onClick={() => reorderExercise(exercise.id, 1)}><ArrowDown size={15} /> Przenieś niżej</button>
                  <button type="button" onClick={() => toggleEquipmentSensitivity(exercise.id)}><MapPin size={15} /> Zależne od maszyny: {isEquipmentSensitive(exercise) ? 'tak' : 'nie'}</button>
                  <button type="button" onClick={() => { toggleSkip(exercise.id); setExerciseMenu(null) }}>{exercise.skipped ? <Play size={15} /> : <X size={15} />}{exercise.skipped ? 'Przywróć' : 'Pomiń'}</button>
                  <button type="button" onClick={() => { toggleNote(exercise.id); setExerciseMenu(null) }}><NotebookPen size={15} /> Notatka</button>
                  <button type="button" onClick={() => { setHistoryExercise(exercise); setExerciseMenu(null) }}><History size={15} /> Historia</button>
                </div>}
              </div>
            </header>

            {!exercise.skipped && isExpanded && <div className="exercise-card__body">
              <div className="previous-result previous-result-v2">
                <div><span>{previous ? 'OSTATNI PORÓWNYWALNY WYNIK' : 'OSTATNI WYNIK'}</span>{(previous ?? latest) && <small>{formatLongDate((previous ?? latest)!.workout.date)} · {formatGymName((previous ?? latest)!.workout.gymLocation)}</small>}</div>
                {(previous ?? latest) ? <strong>{(previous ?? latest)!.exercise.sets.filter(hasVisibleValue).map(formatSet).join('   ')}</strong> : <strong className="muted">Brak wcześniejszych wyników</strong>}
                {comparisonIssue && <p className="comparison-notice">{comparisonIssue.label}</p>}
              </div>

              {noteOpen.has(exercise.id) && <label className="field exercise-note"><span>Notatka do ćwiczenia</span><input type="text" placeholder="Technika, odczucia, cel na następną sesję…" value={exercise.note ?? ''} onChange={(event) => updateExerciseNote(exercise.id, event.target.value)} /></label>}

              <div className="sets-header sets-header-v2"><span>#</span><span>KG</span><span>POWT.</span><span>PROGRES</span><span /></div>
              <div className="sets-list">{exercise.sets.map((set, index) => {
                const previousSet = previous?.exercise.sets[index]
                const progress = compareSets(set, previousSet, exercise.prescription)
                return <div className="set-row set-row-v2" key={set.id}>
                  <span className="set-number">{index + 1}</span>
                  <DecimalInput aria-label={`Seria ${index + 1}, ciężar`} min="0" placeholder={previousSet?.weight !== undefined ? formatDecimal(previousSet.weight) : '—'} value={set.weight} onValueChange={(value) => updateSet(exercise.id, set.id, 'weight', value)} />
                  <input aria-label={`Seria ${index + 1}, powtórzenia`} type="number" inputMode="numeric" step="1" min="0" placeholder={previousSet?.reps !== undefined ? formatDecimal(previousSet.reps, 0) : '—'} value={set.reps ?? ''} onChange={(event) => updateSet(exercise.id, set.id, 'reps', event.target.value === '' ? undefined : Number(event.target.value))} />
                  <span className={`set-progress ${progress.positive ? 'set-progress--positive' : ''}`}>{progress.label}</span>
                  <button type="button" className="icon-button icon-button--subtle" onClick={() => removeSet(exercise.id, set.id)} disabled={exercise.sets.length === 1} aria-label="Usuń serię"><X size={16} /></button>
                </div>
              })}</div>
              <button type="button" className="add-set-button" onClick={() => addSet(exercise.id)}><Plus size={15} /> Dodaj serię</button>
            </div>}
          </article>
        })}</div>

        {addingCustom ? <div className="card custom-exercise-form"><label className="field"><span>Nazwa ćwiczenia</span><input autoFocus type="text" placeholder="Np. unoszenie ramion Y na wyciągu" value={customName} onChange={(event) => setCustomName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomExercise() } }} /></label><label className="checkbox-field"><input type="checkbox" checked={customEquipmentSensitive} onChange={(event) => setCustomEquipmentSensitive(event.target.checked)} /><span>Wynik zależy od maszyny / siłowni</span></label><button type="button" className="button button--primary" onClick={addCustomExercise}>Dodaj</button><button type="button" className="icon-button" onClick={() => { setAddingCustom(false); setCustomEquipmentSensitive(false) }} aria-label="Anuluj"><X size={17} /></button></div> : <button type="button" className="add-exercise-button" onClick={() => setAddingCustom(true)}><Plus size={18} /> Dodaj własne ćwiczenie</button>}

        <section className="card workout-finish"><label className="field"><span>Notatka do treningu <em>opcjonalnie</em></span><textarea rows={3} placeholder="Energia, technika, ogólne samopoczucie…" value={note} onChange={(event) => setNote(event.target.value)} /></label><div><p>Serie bez ciężaru i powtórzeń zostaną pominięte.</p><button type="submit" className="button button--primary"><Check size={18} /> Zapisz trening</button></div></section>
      </form>

      <WorkoutHistory workouts={data.workouts} onOpen={setSelectedWorkoutId} />
      {historyExercise && <ExerciseHistoryModal reference={historyExercise} workouts={data.workouts} onClose={() => setHistoryExercise(null)} />}
      {selectedWorkout && <WorkoutDetailsModal workout={selectedWorkout} templates={data.templates} gymLocations={savedGymLocations} onUpdate={updateWorkout} onDelete={deleteWorkout} onClose={() => setSelectedWorkoutId(null)} />}
      {templateEditorTarget && data.templates.find((template) => template.id === templateEditorTarget.templateId) && <TemplateEditor template={data.templates.find((template) => template.id === templateEditorTarget.templateId)!} initialExerciseId={templateEditorTarget.exerciseId} onSave={(template) => { updateTemplate(template); showToast('Szablon zapisany') }} onClose={() => setTemplateEditorTarget(null)} />}
    </div>
  )
}

function WorkoutHistory({ workouts, onOpen }: { workouts: Workout[]; onOpen: (id: string) => void }) {
  const sorted = [...workouts].sort((a, b) => b.date.localeCompare(a.date))
  return <section className="card workout-history workout-history--open">
    <div className="workout-history__heading"><div><History size={18} /><span><strong>Historia treningów</strong><small>{workouts.length} zapisanych sesji</small></span></div></div>
    {sorted.length ? <div className="workout-history__list">{sorted.map((workout) => {
      const completed = workout.exercises.filter((exercise) => !exercise.skipped && exercise.sets.some(hasVisibleValue))
      const highlights = completed.slice(0, 2).map((exercise) => `${exercise.name}: ${formatSet(getBestSet(exercise))}`).join(' · ')
      return <button type="button" className="workout-history__row" key={workout.id} onClick={() => onOpen(workout.id)}>
        <span className="template-code template-code--small">{workout.templateCode}</span>
        <span className="workout-history__summary"><strong>{workout.templateName}</strong><small>{formatLongDate(workout.date)} · Siłownia: {formatGymName(workout.gymLocation)}</small>{highlights && <small>{highlights}</small>}</span>
        <span className="workout-history__count">{completed.length} ćwiczeń</span>
        <ChevronDown size={17} />
      </button>
    })}</div> : <p className="workout-history__empty">Jeszcze nie zapisano żadnego treningu.</p>}
  </section>
}

function WorkoutDetailsModal({ workout, templates, gymLocations, onUpdate, onDelete, onClose }: {
  workout: Workout
  templates: TrainingTemplate[]
  gymLocations: string[]
  onUpdate: (workout: Workout) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const { showToast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Workout>(() => cloneWorkout(workout))

  useEffect(() => {
    setDraft(cloneWorkout(workout))
    setEditing(false)
  }, [workout.id])

  const updateDraftExercise = (exerciseId: string, updates: Partial<WorkoutExercise>) => setDraft((current) => ({
    ...current,
    exercises: current.exercises.map((exercise) => exercise.id === exerciseId ? { ...exercise, ...updates } : exercise),
  }))

  const updateDraftSet = (exerciseId: string, setId: string, key: 'weight' | 'reps', value: number | undefined) => setDraft((current) => ({
    ...current,
    exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise,
      sets: exercise.sets.map((set) => set.id === setId ? { ...set, [key]: value } : set),
    }),
  }))

  const addDraftSet = (exerciseId: string) => setDraft((current) => ({
    ...current,
    exercises: current.exercises.map((exercise) => exercise.id === exerciseId ? { ...exercise, sets: [...exercise.sets, emptySet()] } : exercise),
  }))

  const removeDraftSet = (exerciseId: string, setId: string) => setDraft((current) => ({
    ...current,
    exercises: current.exercises.map((exercise) => exercise.id === exerciseId ? { ...exercise, sets: exercise.sets.filter((set) => set.id !== setId) } : exercise),
  }))

  const addDraftExercise = () => setDraft((current) => ({
    ...current,
    exercises: [...current.exercises, { id: `custom-${createId()}`, name: '', prescription: 'Własne ćwiczenie', sets: [emptySet()], isCustom: true }],
  }))

  const removeDraftExercise = (exerciseId: string) => setDraft((current) => ({ ...current, exercises: current.exercises.filter((exercise) => exercise.id !== exerciseId) }))

  const moveDraftExercise = (exerciseId: string, direction: -1 | 1) => setDraft((current) => {
    const index = current.exercises.findIndex((exercise) => exercise.id === exerciseId)
    return { ...current, exercises: moveExercise(current.exercises, index, index + direction) }
  })

  const changeTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId)
    if (!template) return
    setDraft((current) => ({ ...current, templateId: template.id, templateCode: template.code, templateName: template.name }))
  }

  const cancelEditing = () => {
    setDraft(cloneWorkout(workout))
    setEditing(false)
  }

  const saveChanges = () => {
    const exercises = draft.exercises.map((exercise) => ({
      ...exercise,
      name: exercise.name.trim() || 'Ćwiczenie',
      note: exercise.note?.trim() || undefined,
      sets: exercise.sets.filter(hasStoredValue),
    }))
    if (!exercises.some((exercise) => !exercise.skipped && exercise.sets.some(hasVisibleValue))) {
      window.alert('Trening musi zawierać przynajmniej jedną serię z ciężarem lub powtórzeniami.')
      return
    }
    onUpdate({ ...draft, id: workout.id, gymLocation: draft.gymLocation?.trim() || undefined, exercises, note: draft.note?.trim() || undefined })
    showToast('Trening zaktualizowany')
    onClose()
  }

  const deleteCurrentWorkout = async () => {
    const confirmed = await confirmAction(`Czy na pewno chcesz usunąć trening z ${formatLongDate(workout.date)}?`, 'Usuń trening')
    if (!confirmed) return
    onDelete(workout.id)
    showToast('Trening usunięty', 'info')
    onClose()
  }

  const gymOptions = [...new Set([...gymLocations, ...(draft.gymLocation ? [draft.gymLocation] : [])])]

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="modal card workout-detail-modal" role="dialog" aria-modal="true" aria-label={`${workout.templateName}, ${formatLongDate(workout.date)}`} onMouseDown={(event) => event.stopPropagation()}>
      <header className="workout-detail-modal__header">
        <div><span className="section-kicker">{editing ? 'EDYCJA TRENINGU' : 'ZAPISANY TRENING'}</span><h2>{draft.templateName}</h2><p>{formatLongDate(draft.date)}</p></div>
        <button className="icon-button" onClick={onClose} aria-label="Zamknij"><X size={20} /></button>
      </header>

      {editing ? <>
        <div className="workout-edit-meta">
          <label className="field"><span>Data</span><input type="date" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /></label>
          <label className="field"><span>Typ treningu</span><select value={draft.templateId} onChange={(event) => changeTemplate(event.target.value)}>{templates.map((template) => <option value={template.id} key={template.id}>{template.code} — {template.name}</option>)}</select></label>
          <label className="field"><span>Siłownia</span><select value={draft.gymLocation ?? ''} onChange={(event) => setDraft((current) => ({ ...current, gymLocation: event.target.value || undefined }))}><option value="">Nie podano</option>{gymOptions.map((location) => <option value={location} key={location}>{location}</option>)}</select></label>
          <label className="field"><span>Czas <em>opcjonalnie</em></span><div className="input-with-unit"><input type="number" min="1" value={draft.duration ?? ''} onChange={(event) => setDraft((current) => ({ ...current, duration: event.target.value === '' ? undefined : Number(event.target.value) }))} /><span>min</span></div></label>
        </div>

        <div className="workout-edit-exercises">{draft.exercises.map((exercise, exerciseIndex) => <article className="workout-edit-exercise" key={exercise.id}>
          <div className="workout-edit-exercise__header"><span>{String(exerciseIndex + 1).padStart(2, '0')}</span><label className="field"><span>Ćwiczenie</span><input type="text" value={exercise.name} placeholder="Nazwa ćwiczenia" onChange={(event) => updateDraftExercise(exercise.id, { name: event.target.value })} /></label><div className="workout-edit-order"><button type="button" className="icon-button" disabled={exerciseIndex === 0} onClick={() => moveDraftExercise(exercise.id, -1)} aria-label="Przenieś ćwiczenie wyżej"><ArrowUp size={16} /></button><button type="button" className="icon-button" disabled={exerciseIndex === draft.exercises.length - 1} onClick={() => moveDraftExercise(exercise.id, 1)} aria-label="Przenieś ćwiczenie niżej"><ArrowDown size={16} /></button></div><button type="button" className="icon-button icon-button--danger" onClick={() => removeDraftExercise(exercise.id)} aria-label="Usuń ćwiczenie"><Trash2 size={16} /></button></div>
          <label className="checkbox-field workout-edit-equipment"><input type="checkbox" checked={isEquipmentSensitive(exercise)} onChange={(event) => updateDraftExercise(exercise.id, { equipmentSensitive: event.target.checked })} /><span>Wynik zależy od maszyny / siłowni</span></label>
          <div className="workout-edit-sets"><div className="workout-edit-set workout-edit-set--header"><span>#</span><span>KG</span><span>POWT.</span><span /></div>{exercise.sets.map((set, index) => <div className="workout-edit-set" key={set.id}><span className="set-number">{index + 1}</span><DecimalInput aria-label={`Seria ${index + 1}, ciężar`} min="0" value={set.weight} onValueChange={(value) => updateDraftSet(exercise.id, set.id, 'weight', value)} /><input aria-label={`Seria ${index + 1}, powtórzenia`} type="number" inputMode="numeric" step="1" min="0" value={set.reps ?? ''} onChange={(event) => updateDraftSet(exercise.id, set.id, 'reps', event.target.value === '' ? undefined : Number(event.target.value))} /><button type="button" className="icon-button icon-button--subtle" onClick={() => removeDraftSet(exercise.id, set.id)} aria-label="Usuń serię"><X size={15} /></button></div>)}</div>
          <button type="button" className="add-set-button" onClick={() => addDraftSet(exercise.id)}><Plus size={14} /> Dodaj serię</button>
          <label className="field workout-edit-note"><span>Notatka do ćwiczenia</span><input type="text" value={exercise.note ?? ''} placeholder="Technika, odczucia, kolejny cel…" onChange={(event) => updateDraftExercise(exercise.id, { note: event.target.value })} /></label>
        </article>)}</div>
        <button type="button" className="add-exercise-button" onClick={addDraftExercise}><Plus size={17} /> Dodaj ćwiczenie</button>
        <label className="field workout-edit-workout-note"><span>Notatka do treningu</span><textarea rows={3} value={draft.note ?? ''} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label>
        <footer className="workout-detail-actions"><button type="button" className="button button--ghost" onClick={cancelEditing}><X size={16} /> Anuluj</button><button type="button" className="button button--primary" onClick={saveChanges}><Save size={16} /> Zapisz zmiany</button></footer>
      </> : <>
        <div className="workout-detail-meta"><span className="template-code">{workout.templateCode}</span><div><strong>{workout.templateName}</strong><small>{workout.exercises.filter((exercise) => !exercise.skipped && exercise.sets.some(hasVisibleValue)).length} ćwiczeń{workout.duration ? ` · ${workout.duration} min` : ''}</small><small><MapPin size={13} /> Siłownia: {formatGymName(workout.gymLocation)}</small></div></div>
        <div className="workout-detail-exercises">{workout.exercises.filter((exercise) => !exercise.skipped && (exercise.sets.some(hasVisibleValue) || exercise.note)).map((exercise) => <article key={exercise.id}><div><strong>{exercise.name}</strong>{exercise.prescription && <small>{exercise.prescription}</small>}</div><div className="workout-detail-sets">{exercise.sets.filter(hasVisibleValue).map((set, index) => <span key={set.id}><small>{index + 1}</small>{formatDecimal(set.weight)} × {formatDecimal(set.reps, 0)}</span>)}</div>{exercise.note && <p>{exercise.note}</p>}</article>)}</div>
        {workout.note && <div className="workout-detail-note"><span>NOTATKA DO TRENINGU</span><p>{workout.note}</p></div>}
        <footer className="workout-detail-actions workout-detail-actions--view"><button type="button" className="button button--ghost workout-delete-button" onClick={deleteCurrentWorkout}><Trash2 size={16} /> Usuń trening</button><button type="button" className="button button--primary" onClick={() => setEditing(true)}><Edit3 size={16} /> Edytuj trening</button></footer>
      </>}
    </section>
  </div>
}

const ALL_GYMS_FILTER = 'all'
const MISSING_GYM_FILTER = 'missing'
const gymFilterToken = (name: string) => `gym:${encodeURIComponent(name)}`

function ExerciseHistoryModal({ reference, workouts, onClose }: { reference: WorkoutExercise; workouts: Workout[]; onClose: () => void }) {
  const [gymFilter, setGymFilter] = useState(ALL_GYMS_FILTER)
  const history = useMemo(() => [...workouts]
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((workout) => workout.exercises
      .filter((exercise) => exercisesMatch(exercise, reference) && !exercise.skipped)
      .map((exercise) => ({ workout, exercise })))
    .filter((item) => item.exercise.sets.some(hasVisibleValue)), [reference, workouts])
  const gymNames = [...new Set(history.map((item) => item.workout.gymLocation?.trim()).filter((name): name is string => Boolean(name)))]
  const hasMissingGym = history.some((item) => !item.workout.gymLocation?.trim())
  const selectedGym = gymFilter.startsWith('gym:') ? decodeURIComponent(gymFilter.slice(4)) : undefined
  const filteredHistory = history.filter((item) => {
    if (gymFilter === ALL_GYMS_FILTER) return true
    if (gymFilter === MISSING_GYM_FILTER) return !item.workout.gymLocation?.trim()
    return item.workout.gymLocation?.trim() === selectedGym
  })
  const equipmentSensitive = reference.equipmentSensitive
    ?? (isEquipmentSensitive(reference) || history.some((item) => isEquipmentSensitive(item.exercise)))
  const oneKnownGymOnly = !hasMissingGym && gymNames.length === 1
  const showComparableChart = !equipmentSensitive || Boolean(selectedGym) || (gymFilter === ALL_GYMS_FILTER && oneKnownGymOnly)
  const chartData = filteredHistory
    .map(({ workout, exercise }) => {
      const top = getBestSet(exercise)
      return { date: workout.date, label: workout.date.slice(5).replace('-', '.'), weight: top?.weight, reps: top?.reps, gym: formatGymName(workout.gymLocation) }
    })
    .filter((item) => item.weight !== undefined)

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="modal card exercise-history-modal" role="dialog" aria-modal="true" aria-label={`Historia: ${reference.name}`} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="section-kicker">HISTORIA ĆWICZENIA</span><h2>{reference.name}</h2>{equipmentSensitive && <small className="equipment-badge"><MapPin size={13} /> Wynik zależny od siłowni</small>}</div><button className="icon-button" onClick={onClose} aria-label="Zamknij"><X size={20} /></button></header>
      {history.length ? <>
        <label className="history-gym-filter"><span>Siłownia</span><select value={gymFilter} onChange={(event) => setGymFilter(event.target.value)}><option value={ALL_GYMS_FILTER}>Wszystkie siłownie</option>{gymNames.map((name) => <option value={gymFilterToken(name)} key={name}>{name}</option>)}{hasMissingGym && <option value={MISSING_GYM_FILTER}>Nie podano</option>}</select></label>
        {showComparableChart && chartData.length ? <div className="exercise-history-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,.055)" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" stroke="#6f767d" tickLine={false} axisLine={false} /><YAxis domain={['dataMin - 5', 'dataMax + 5']} stroke="#6f767d" tickLine={false} axisLine={false} /><Tooltip contentStyle={{ background: '#171a1e', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12 }} formatter={(value, key) => [key === 'weight' ? `${value ?? '—'} kg` : value ?? '—', key === 'weight' ? 'Najlepsza seria' : 'Powtórzenia']} labelFormatter={(_, payload) => payload?.[0]?.payload?.gym ?? ''} /><Line type="monotone" dataKey="weight" stroke="#2997ff" strokeWidth={2.5} dot={{ r: 3, fill: '#2997ff', strokeWidth: 0 }} /></LineChart></ResponsiveContainer></div> : equipmentSensitive && <p className="history-comparison-notice">Wybierz konkretną siłownię, aby zobaczyć porównywalny trend na tej samej maszynie.</p>}
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Data i siłownia</th><th>Serie: ciężar × powt.</th><th>Najlepsza</th></tr></thead><tbody>{[...filteredHistory].reverse().map(({ workout, exercise }) => { const top = getBestSet(exercise); return <tr key={`${workout.id}-${exercise.id}`}><td><strong>{formatLongDate(workout.date)}</strong><small>Siłownia: {formatGymName(workout.gymLocation)}</small></td><td>{exercise.sets.filter(hasVisibleValue).map((set) => `${formatDecimal(set.weight)} × ${formatDecimal(set.reps, 0)}`).join('  |  ')}</td><td>{top ? `${formatDecimal(top.weight)} kg × ${formatDecimal(top.reps, 0)}` : '—'}</td></tr> })}</tbody></table></div>
      </> : <div className="history-empty"><BarChart3 size={24} /><p>Jeszcze brak danych</p><span>Zapisz pierwszą serię, aby zobaczyć progres.</span></div>}
    </section>
  </div>
}
