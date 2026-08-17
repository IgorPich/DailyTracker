import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  History,
  MoreHorizontal,
  NotebookPen,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TemplateExercise, TrainingTemplate, Workout, WorkoutExercise, WorkoutSet } from '../types'
import { formatLongDate, isoToday } from '../utils/date'
import { createId } from '../utils/id'

const emptySet = (): WorkoutSet => ({ id: createId() })
const fromTemplateExercise = (item: TemplateExercise): WorkoutExercise => ({ id: item.id, name: item.name, prescription: item.prescription, sets: Array.from({ length: item.defaultSets }, emptySet) })

const bestSet = (exercise: WorkoutExercise) => exercise.sets
  .filter((set) => set.weight !== undefined && set.reps !== undefined)
  .sort((a, b) => ((b.weight ?? 0) * (b.reps ?? 0)) - ((a.weight ?? 0) * (a.reps ?? 0)))[0]

const isCompound = (name: string) => /bench|press|pull-up|row|squat|deadlift|pulldown|hack|romanian/i.test(name)

const progressLabel = (current: WorkoutSet, previous?: WorkoutSet) => {
  if (!previous || current.weight === undefined || current.reps === undefined || previous.weight === undefined || previous.reps === undefined) return null
  if (current.weight > previous.weight) return `+${Number((current.weight - previous.weight).toFixed(2))} kg`
  if (current.weight === previous.weight && current.reps > previous.reps) return `+${current.reps - previous.reps} rep`
  return '—'
}

export function Training() {
  const { data, addWorkout, deleteWorkout } = useApp()
  const { showToast } = useToast()
  const lastWorkout = [...data.workouts].sort((a, b) => b.date.localeCompare(a.date))[0]
  const lastIndex = lastWorkout ? data.templates.findIndex((template) => template.id === lastWorkout.templateId) : -1
  const suggested = data.templates[(lastIndex + 1 + data.templates.length) % data.templates.length] ?? data.templates[0]
  const [selectedId, setSelectedId] = useState(suggested.id)
  const selected = data.templates.find((template) => template.id === selectedId) ?? data.templates[0]
  const [date, setDate] = useState(isoToday())
  const [duration, setDuration] = useState<number | undefined>()
  const [note, setNote] = useState('')
  const [exercises, setExercises] = useState<WorkoutExercise[]>(() => selected.exercises.map(fromTemplateExercise))
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selected.exercises.map((item) => item.id)))
  const [noteOpen, setNoteOpen] = useState<Set<string>>(new Set())
  const [exerciseMenu, setExerciseMenu] = useState<string | null>(null)
  const [historyExercise, setHistoryExercise] = useState<string | null>(null)
  const [addingCustom, setAddingCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  const [restTimer, setRestTimer] = useState<{ seconds: number; total: number; running: boolean } | null>(null)

  useEffect(() => {
    if (!restTimer?.running || restTimer.seconds <= 0) return
    const timer = window.setInterval(() => setRestTimer((current) => {
      if (!current || current.seconds <= 1) return current ? { ...current, seconds: 0, running: false } : null
      return { ...current, seconds: current.seconds - 1 }
    }), 1000)
    return () => window.clearInterval(timer)
  }, [restTimer?.running, restTimer?.seconds])

  const previousFor = (exerciseName: string) => [...data.workouts]
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap((workout) => workout.exercises.map((exercise) => ({ workout, exercise })))
    .find((item) => item.exercise.name === exerciseName && !item.exercise.skipped && item.exercise.sets.some((set) => set.weight !== undefined || set.reps !== undefined))

  const selectTemplate = (template: TrainingTemplate) => {
    const hasValues = exercises.some((exercise) => exercise.sets.some((set) => set.weight !== undefined || set.reps !== undefined || set.rir !== undefined))
    if (hasValues && !window.confirm('Zmiana planu wyczyści wpisane serie. Kontynuować?')) return
    setSelectedId(template.id)
    setExercises(template.exercises.map(fromTemplateExercise))
    setExpanded(new Set(template.exercises.map((item) => item.id)))
    setNoteOpen(new Set())
  }

  const updateSet = (exerciseId: string, setId: string, key: 'weight' | 'reps' | 'rir', value: string) => setExercises((current) => current.map((exercise) => exercise.id !== exerciseId ? exercise : {
    ...exercise,
    sets: exercise.sets.map((set) => set.id !== setId ? set : { ...set, [key]: value === '' ? undefined : Number(value) }),
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

  const fillPrevious = () => {
    setExercises((current) => current.map((exercise) => {
      const previous = previousFor(exercise.name)?.exercise
      if (!previous) return exercise
      const setCount = Math.max(exercise.sets.length, previous.sets.length)
      return {
        ...exercise,
        sets: Array.from({ length: setCount }, (_, index) => ({
          id: exercise.sets[index]?.id ?? createId(),
          weight: previous.sets[index]?.weight,
          rir: previous.sets[index]?.rir,
          reps: exercise.sets[index]?.reps,
        })),
      }
    }))
    showToast('Wpisano poprzednie ciężary i RIR', 'info')
  }

  const addCustomExercise = () => {
    const name = customName.trim()
    if (!name) return
    const id = `custom-${createId()}`
    setExercises((current) => [...current, { id, name, prescription: 'Własne ćwiczenie', sets: [emptySet(), emptySet(), emptySet()], isCustom: true }])
    setExpanded((current) => new Set(current).add(id))
    setCustomName('')
    setAddingCustom(false)
  }

  const startRestTimer = (exercise: WorkoutExercise, set: WorkoutSet) => {
    if (set.reps === undefined) return
    const total = isCompound(exercise.name) ? 180 : 90
    setRestTimer({ seconds: total, total, running: true })
  }

  const saveWorkout = (event: FormEvent) => {
    event.preventDefault()
    const completed = exercises.map((exercise) => ({ ...exercise, note: exercise.note?.trim() || undefined, sets: exercise.sets.filter((set) => set.weight !== undefined || set.reps !== undefined || set.rir !== undefined) }))
    if (!completed.some((exercise) => !exercise.skipped && exercise.sets.length)) {
      window.alert('Wpisz przynajmniej jedną serię przed zapisaniem treningu.')
      return
    }
    addWorkout({ id: createId(), date, templateId: selected.id, templateCode: selected.code, templateName: selected.name, exercises: completed, duration, note: note.trim() || undefined })
    setExercises(selected.exercises.map(fromTemplateExercise))
    setExpanded(new Set(selected.exercises.map((item) => item.id)))
    setDuration(undefined)
    setNote('')
    setRestTimer(null)
    showToast('Trening zapisany')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const timerText = restTimer ? `${Math.floor(restTimer.seconds / 60)}:${String(restTimer.seconds % 60).padStart(2, '0')}` : ''

  return (
    <div className="page training-page training-v2">
      <PageHeader eyebrow="ROLLING SPLIT" title="Trening" description={lastWorkout ? `Ostatnio: ${lastWorkout.templateCode} · ${lastWorkout.templateName}, ${formatLongDate(lastWorkout.date)}` : 'Wybierz plan i zacznij zapisywać serie.'} />

      <section className="template-picker" aria-label="Wybierz trening">{data.templates.map((template) => <button key={template.id} className={selected.id === template.id ? 'active' : ''} onClick={() => selectTemplate(template)}><span>{template.code}</span><div><strong>{template.name}</strong><small>{template.exercises.length} ćwiczeń</small></div>{suggested.id === template.id && <em>SUGEROWANY</em>}</button>)}</section>

      <form onSubmit={saveWorkout}>
        <section className="card workout-meta workout-meta-v2">
          <div className="workout-meta__title"><span className="template-code">{selected.code}</span><div><span className="section-kicker">AKTYWNY TRENING</span><h2>{selected.name}</h2></div></div>
          <button type="button" className="button button--ghost autofill-button" onClick={fillPrevious}><Copy size={16} /> Wypełnij poprzednimi wynikami</button>
          <label className="field"><span>Data</span><input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="field"><span>Czas <em>opcjonalnie</em></span><div className="input-with-unit"><input type="number" inputMode="numeric" min="1" placeholder="—" value={duration ?? ''} onChange={(event) => setDuration(event.target.value === '' ? undefined : Number(event.target.value))} /><span>min</span></div></label>
        </section>

        <div className="exercise-list">{exercises.map((exercise, exerciseIndex) => {
          const previous = previousFor(exercise.name)
          const isExpanded = expanded.has(exercise.id)
          return <article className={`card exercise-card ${exercise.skipped ? 'exercise-card--skipped' : ''}`} key={exercise.id}>
            <header className="exercise-card__header">
              <button type="button" className="exercise-title" onClick={() => toggleExpanded(exercise.id)} aria-expanded={isExpanded}>
                <span>{String(exerciseIndex + 1).padStart(2, '0')}</span>
                <div><strong>{exercise.name}</strong><small>{exercise.prescription}</small></div>
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              <div className="exercise-menu-wrap">
                <button type="button" className="icon-button exercise-more" onClick={() => setExerciseMenu((current) => current === exercise.id ? null : exercise.id)} aria-label={`Menu ćwiczenia ${exercise.name}`} aria-expanded={exerciseMenu === exercise.id}><MoreHorizontal size={19} /></button>
                {exerciseMenu === exercise.id && <div className="exercise-menu">
                  <button type="button" onClick={() => { toggleSkip(exercise.id); setExerciseMenu(null) }}>{exercise.skipped ? <Play size={15} /> : <X size={15} />}{exercise.skipped ? 'Przywróć' : 'Pomiń'}</button>
                  <button type="button" onClick={() => { toggleNote(exercise.id); setExerciseMenu(null) }}><NotebookPen size={15} /> Notatka</button>
                  <button type="button" onClick={() => { setHistoryExercise(exercise.name); setExerciseMenu(null) }}><History size={15} /> Historia</button>
                </div>}
              </div>
            </header>

            {!exercise.skipped && isExpanded && <div className="exercise-card__body">
              <div className="previous-result previous-result-v2">
                <div><span>OSTATNIO</span>{previous && <small>{formatLongDate(previous.workout.date)}</small>}</div>
                {previous ? <strong>{previous.exercise.sets.filter((set) => set.weight !== undefined || set.reps !== undefined).map((set) => `${set.weight ?? '—'}×${set.reps ?? '—'}`).join('   ')}</strong> : <strong className="muted">Brak wcześniejszych wyników</strong>}
              </div>

              {noteOpen.has(exercise.id) && <label className="field exercise-note"><span>Notatka do ćwiczenia</span><input type="text" placeholder="Technika, odczucia, cel na następną sesję…" value={exercise.note ?? ''} onChange={(event) => updateExerciseNote(exercise.id, event.target.value)} /></label>}

              <div className="sets-header sets-header-v2"><span>#</span><span>KG</span><span>REPS</span><span>RIR</span><span>PROGRES</span><span /></div>
              <div className="sets-list">{exercise.sets.map((set, index) => {
                const previousSet = previous?.exercise.sets[index]
                const progress = progressLabel(set, previousSet)
                return <div className="set-row set-row-v2" key={set.id}>
                  <span className="set-number">{index + 1}</span>
                  <input aria-label={`Seria ${index + 1}, ciężar`} type="number" inputMode="decimal" step="0.25" min="0" placeholder={previousSet?.weight?.toString() ?? '—'} value={set.weight ?? ''} onChange={(event) => updateSet(exercise.id, set.id, 'weight', event.target.value)} />
                  <input aria-label={`Seria ${index + 1}, powtórzenia`} type="number" inputMode="numeric" step="1" min="0" placeholder={previousSet?.reps?.toString() ?? '—'} value={set.reps ?? ''} onChange={(event) => updateSet(exercise.id, set.id, 'reps', event.target.value)} onBlur={() => startRestTimer(exercise, set)} />
                  <input aria-label={`Seria ${index + 1}, RIR`} type="number" inputMode="numeric" step="1" min="0" max="10" placeholder={previousSet?.rir?.toString() ?? '—'} value={set.rir ?? ''} onChange={(event) => updateSet(exercise.id, set.id, 'rir', event.target.value)} />
                  <span className={`set-progress ${progress && progress !== '—' ? 'set-progress--positive' : ''}`}>{progress ?? '—'}</span>
                  <button type="button" className="icon-button icon-button--subtle" onClick={() => removeSet(exercise.id, set.id)} disabled={exercise.sets.length === 1} aria-label="Usuń serię"><X size={16} /></button>
                </div>
              })}</div>
              <button type="button" className="add-set-button" onClick={() => addSet(exercise.id)}><Plus size={15} /> Dodaj serię</button>
            </div>}
          </article>
        })}</div>

        {addingCustom ? <div className="card custom-exercise-form"><label className="field"><span>Nazwa ćwiczenia</span><input autoFocus type="text" placeholder="Np. Cable Y-Raise" value={customName} onChange={(event) => setCustomName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomExercise() } }} /></label><button type="button" className="button button--primary" onClick={addCustomExercise}>Dodaj</button><button type="button" className="icon-button" onClick={() => setAddingCustom(false)} aria-label="Anuluj"><X size={17} /></button></div> : <button type="button" className="add-exercise-button" onClick={() => setAddingCustom(true)}><Plus size={18} /> Dodaj własne ćwiczenie</button>}

        <section className="card workout-finish"><label className="field"><span>Notatka do treningu <em>opcjonalnie</em></span><textarea rows={3} placeholder="Energia, technika, ogólne samopoczucie…" value={note} onChange={(event) => setNote(event.target.value)} /></label><div><p>Serie bez żadnej wartości zostaną pominięte.</p><button type="submit" className="button button--primary"><Check size={18} /> Zapisz trening</button></div></section>
      </form>

      <WorkoutHistory workouts={data.workouts} onDelete={deleteWorkout} />
      {historyExercise && <ExerciseHistoryModal name={historyExercise} workouts={data.workouts} onClose={() => setHistoryExercise(null)} />}

      {restTimer && <aside className={`rest-timer ${restTimer.seconds === 0 ? 'rest-timer--done' : ''}`} aria-live="polite">
        <Clock3 size={17} /><div><span>Odpoczynek</span><strong>{restTimer.seconds === 0 ? 'Gotowe' : timerText}</strong></div>
        {restTimer.seconds > 0 && <button onClick={() => setRestTimer((current) => current ? { ...current, running: !current.running } : null)} aria-label={restTimer.running ? 'Wstrzymaj timer' : 'Wznów timer'}>{restTimer.running ? <Pause size={15} /> : <Play size={15} />}</button>}
        <button onClick={() => setRestTimer(null)} aria-label="Zamknij timer"><X size={15} /></button>
      </aside>}
    </div>
  )
}

function WorkoutHistory({ workouts, onDelete }: { workouts: Workout[]; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const sorted = [...workouts].sort((a, b) => b.date.localeCompare(a.date))
  return <section className="card workout-history"><button className="workout-history__toggle" onClick={() => setOpen((current) => !current)}><div><History size={18} /><span><strong>Historia treningów</strong><small>{workouts.length} zapisanych sesji</small></span></div>{open ? <ChevronUp size={19} /> : <ChevronDown size={19} />}</button>{open && (sorted.length ? <div className="workout-history__list">{sorted.map((workout) => <div key={workout.id}><span className="template-code template-code--small">{workout.templateCode}</span><div><strong>{workout.templateName}</strong><small>{formatLongDate(workout.date)}{workout.duration ? ` · ${workout.duration} min` : ''}</small></div><span>{workout.exercises.filter((exercise) => !exercise.skipped && exercise.sets.length).length} ćwiczeń</span><button className="icon-button icon-button--danger" onClick={() => window.confirm('Usunąć ten trening?') && onDelete(workout.id)} aria-label="Usuń trening"><Trash2 size={16} /></button></div>)}</div> : <p className="workout-history__empty">Jeszcze nie zapisano żadnego treningu.</p>)}</section>
}

function ExerciseHistoryModal({ name, workouts, onClose }: { name: string; workouts: Workout[]; onClose: () => void }) {
  const history = useMemo(() => [...workouts].sort((a, b) => a.date.localeCompare(b.date)).flatMap((workout) => workout.exercises.filter((exercise) => exercise.name === name && !exercise.skipped).map((exercise) => ({ workout, exercise }))).filter((item) => item.exercise.sets.length), [name, workouts])
  const chartData = history.map(({ workout, exercise }) => { const top = bestSet(exercise); return { date: workout.date, label: workout.date.slice(5).replace('-', '.'), weight: top?.weight, reps: top?.reps } }).filter((item) => item.weight !== undefined)
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal card exercise-history-modal" role="dialog" aria-modal="true" aria-label={`Historia: ${name}`} onMouseDown={(event) => event.stopPropagation()}><header><div><span className="section-kicker">HISTORIA ĆWICZENIA</span><h2>{name}</h2></div><button className="icon-button" onClick={onClose} aria-label="Zamknij"><X size={20} /></button></header>{history.length ? <><div className="exercise-history-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,.055)" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" stroke="#6f767d" tickLine={false} axisLine={false} /><YAxis domain={['dataMin - 5', 'dataMax + 5']} stroke="#6f767d" tickLine={false} axisLine={false} /><Tooltip contentStyle={{ background: '#171a1e', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12 }} formatter={(value, key) => [key === 'weight' ? `${value ?? '—'} kg` : value ?? '—', key === 'weight' ? 'Najlepsza seria' : 'Powtórzenia']} /><Line type="monotone" dataKey="weight" stroke="#2997ff" strokeWidth={2.5} dot={{ r: 3, fill: '#2997ff', strokeWidth: 0 }} /></LineChart></ResponsiveContainer></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Data</th><th>Serie: ciężar × powt. · RIR</th><th>Najlepsza</th></tr></thead><tbody>{[...history].reverse().map(({ workout, exercise }) => { const top = bestSet(exercise); return <tr key={`${workout.id}-${exercise.id}`}><td><strong>{formatLongDate(workout.date)}</strong></td><td>{exercise.sets.map((set) => `${set.weight ?? '—'} × ${set.reps ?? '—'} · ${set.rir ?? '—'}`).join('  |  ')}</td><td>{top ? `${top.weight} kg × ${top.reps}` : '—'}</td></tr> })}</tbody></table></div></> : <div className="history-empty"><BarChart3 size={24} /><p>Jeszcze brak danych</p><span>Zapisz pierwszą serię, aby zobaczyć progres.</span></div>}</section></div>
}
