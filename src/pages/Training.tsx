import { useMemo, useState, type FormEvent } from 'react'
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  History,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../context/AppContext'
import type { TemplateExercise, TrainingTemplate, Workout, WorkoutExercise, WorkoutSet } from '../types'
import { formatLongDate, isoToday } from '../utils/date'
import { createId } from '../utils/id'

const emptySet = (): WorkoutSet => ({ id: createId() })

const fromTemplateExercise = (item: TemplateExercise): WorkoutExercise => ({
  id: item.id,
  name: item.name,
  prescription: item.prescription,
  sets: Array.from({ length: item.defaultSets }, emptySet),
})

const bestSet = (exercise: WorkoutExercise) =>
  exercise.sets
    .filter((set) => set.weight !== undefined && set.reps !== undefined)
    .sort((a, b) => ((b.weight ?? 0) * (b.reps ?? 0)) - ((a.weight ?? 0) * (a.reps ?? 0)))[0]

export function Training() {
  const { data, addWorkout, deleteWorkout } = useApp()
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
  const [historyExercise, setHistoryExercise] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const selectTemplate = (template: TrainingTemplate) => {
    const hasValues = exercises.some((exercise) => exercise.sets.some((set) => set.weight !== undefined || set.reps !== undefined || set.rir !== undefined))
    if (hasValues && !window.confirm('Zmiana planu wyczyści wpisane serie. Kontynuować?')) return
    setSelectedId(template.id)
    setExercises(template.exercises.map(fromTemplateExercise))
    setExpanded(new Set(template.exercises.map((item) => item.id)))
    setSaved(false)
  }

  const previousFor = (exerciseName: string) => {
    const match = [...data.workouts]
      .sort((a, b) => b.date.localeCompare(a.date))
      .flatMap((workout) => workout.exercises.map((exercise) => ({ workout, exercise })))
      .find((item) => item.exercise.name === exerciseName && !item.exercise.skipped && item.exercise.sets.some((set) => set.weight !== undefined || set.reps !== undefined))
    return match
  }

  const updateSet = (exerciseId: string, setId: string, key: 'weight' | 'reps' | 'rir', value: string) => {
    setExercises((current) => current.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise,
      sets: exercise.sets.map((set) => set.id !== setId ? set : { ...set, [key]: value === '' ? undefined : Number(value) }),
    }))
  }

  const addSet = (exerciseId: string) => {
    setExercises((current) => current.map((exercise) => exercise.id === exerciseId ? { ...exercise, sets: [...exercise.sets, emptySet()] } : exercise))
  }

  const removeSet = (exerciseId: string, setId: string) => {
    setExercises((current) => current.map((exercise) => exercise.id === exerciseId ? { ...exercise, sets: exercise.sets.filter((set) => set.id !== setId) } : exercise))
  }

  const toggleSkip = (exerciseId: string) => {
    setExercises((current) => current.map((exercise) => exercise.id === exerciseId ? { ...exercise, skipped: !exercise.skipped } : exercise))
  }

  const toggleExpanded = (exerciseId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(exerciseId)) next.delete(exerciseId)
      else next.add(exerciseId)
      return next
    })
  }

  const addCustomExercise = () => {
    const name = window.prompt('Nazwa własnego ćwiczenia:')?.trim()
    if (!name) return
    const id = `custom-${createId()}`
    setExercises((current) => [...current, { id, name, prescription: 'Własne ćwiczenie', sets: [emptySet(), emptySet(), emptySet()], isCustom: true }])
    setExpanded((current) => new Set(current).add(id))
  }

  const saveWorkout = (event: FormEvent) => {
    event.preventDefault()
    const completed = exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.filter((set) => set.weight !== undefined || set.reps !== undefined || set.rir !== undefined),
    }))
    const hasAnySet = completed.some((exercise) => !exercise.skipped && exercise.sets.length)
    if (!hasAnySet) {
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
      note: note.trim() || undefined,
    })
    setExercises(selected.exercises.map(fromTemplateExercise))
    setExpanded(new Set(selected.exercises.map((item) => item.id)))
    setDuration(undefined)
    setNote('')
    setSaved(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="page training-page">
      <PageHeader
        eyebrow="ROLLING SPLIT"
        title="Trening"
        description={lastWorkout ? `Ostatnio: ${lastWorkout.templateCode} · ${lastWorkout.templateName}, ${formatLongDate(lastWorkout.date)}` : 'Wybierz plan i zacznij zapisywać serie.'}
      />

      {saved && <div className="success-banner"><Check size={18} /> Trening został zapisany lokalnie.</div>}

      <section className="template-picker" aria-label="Wybierz trening">
        {data.templates.map((template) => (
          <button key={template.id} className={selected.id === template.id ? 'active' : ''} onClick={() => selectTemplate(template)}>
            <span>{template.code}</span>
            <div><strong>{template.name}</strong><small>{template.exercises.length} ćwiczeń</small></div>
            {suggested.id === template.id && <em>SUGEROWANY</em>}
          </button>
        ))}
      </section>

      <form onSubmit={saveWorkout}>
        <section className="card workout-meta">
          <div className="workout-meta__title"><span className="template-code">{selected.code}</span><div><span className="section-kicker">AKTYWNY TRENING</span><h2>{selected.name}</h2></div></div>
          <label className="field"><span>Data</span><input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="field"><span>Czas <em>opcjonalnie</em></span><div className="input-with-unit"><input type="number" inputMode="numeric" min="1" placeholder="—" value={duration ?? ''} onChange={(event) => setDuration(event.target.value === '' ? undefined : Number(event.target.value))} /><span>min</span></div></label>
        </section>

        <div className="exercise-list">
          {exercises.map((exercise, exerciseIndex) => {
            const previous = previousFor(exercise.name)
            const isExpanded = expanded.has(exercise.id)
            return (
              <article className={`card exercise-card ${exercise.skipped ? 'exercise-card--skipped' : ''}`} key={exercise.id}>
                <header className="exercise-card__header">
                  <button type="button" className="exercise-title" onClick={() => setHistoryExercise(exercise.name)}>
                    <span>{String(exerciseIndex + 1).padStart(2, '0')}</span>
                    <div><strong>{exercise.name}</strong><small>{exercise.prescription}</small></div>
                    <History size={15} />
                  </button>
                  <div className="exercise-card__actions">
                    <button type="button" className={`skip-button ${exercise.skipped ? 'active' : ''}`} onClick={() => toggleSkip(exercise.id)}>{exercise.skipped ? 'Przywróć' : 'Pomiń'}</button>
                    <button type="button" className="icon-button" onClick={() => toggleExpanded(exercise.id)} aria-label={isExpanded ? 'Zwiń' : 'Rozwiń'}>{isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
                  </div>
                </header>

                {!exercise.skipped && isExpanded && (
                  <div className="exercise-card__body">
                    <div className="previous-result">
                      <span>POPRZEDNIO</span>
                      {previous ? (
                        <strong>{previous.exercise.sets.filter((set) => set.weight !== undefined || set.reps !== undefined).map((set) => `${set.weight ?? '—'} kg × ${set.reps ?? '—'}`).join('  ·  ')}</strong>
                      ) : <strong className="muted">Brak wcześniejszych wyników</strong>}
                      {previous && <small>{formatLongDate(previous.workout.date)}</small>}
                    </div>
                    <div className="sets-header"><span>SERIA</span><span>CIĘŻAR <small>kg</small></span><span>POWT.</span><span>RIR</span><span /></div>
                    <div className="sets-list">
                      {exercise.sets.map((set, index) => (
                        <div className="set-row" key={set.id}>
                          <span className="set-number">{index + 1}</span>
                          <input aria-label={`Seria ${index + 1}, ciężar`} type="number" inputMode="decimal" step="0.25" min="0" placeholder="—" value={set.weight ?? ''} onChange={(event) => updateSet(exercise.id, set.id, 'weight', event.target.value)} />
                          <input aria-label={`Seria ${index + 1}, powtórzenia`} type="number" inputMode="numeric" step="1" min="0" placeholder="—" value={set.reps ?? ''} onChange={(event) => updateSet(exercise.id, set.id, 'reps', event.target.value)} />
                          <input aria-label={`Seria ${index + 1}, RIR`} type="number" inputMode="numeric" step="1" min="0" max="10" placeholder="—" value={set.rir ?? ''} onChange={(event) => updateSet(exercise.id, set.id, 'rir', event.target.value)} />
                          <button type="button" className="icon-button icon-button--subtle" onClick={() => removeSet(exercise.id, set.id)} disabled={exercise.sets.length === 1} aria-label="Usuń serię"><X size={16} /></button>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="add-set-button" onClick={() => addSet(exercise.id)}><Plus size={15} /> Dodaj serię</button>
                  </div>
                )}
              </article>
            )
          })}
        </div>

        <button type="button" className="add-exercise-button" onClick={addCustomExercise}><Plus size={18} /> Dodaj własne ćwiczenie</button>

        <section className="card workout-finish">
          <label className="field"><span>Notatka do treningu <em>opcjonalnie</em></span><textarea rows={3} placeholder="Krótka uwaga o technice, energii lub samopoczuciu…" value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <div><p>Serie bez żadnej wartości zostaną pominięte.</p><button type="submit" className="button button--primary"><Check size={18} /> Zapisz trening</button></div>
        </section>
      </form>

      <WorkoutHistory workouts={data.workouts} onDelete={deleteWorkout} />

      {historyExercise && <ExerciseHistoryModal name={historyExercise} workouts={data.workouts} onClose={() => setHistoryExercise(null)} />}
    </div>
  )
}

function WorkoutHistory({ workouts, onDelete }: { workouts: Workout[]; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const sorted = [...workouts].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <section className="card workout-history">
      <button className="workout-history__toggle" onClick={() => setOpen((current) => !current)}>
        <div><History size={18} /><span><strong>Historia treningów</strong><small>{workouts.length} zapisanych sesji</small></span></div>
        {open ? <ChevronUp size={19} /> : <ChevronDown size={19} />}
      </button>
      {open && (
        sorted.length ? <div className="workout-history__list">{sorted.map((workout) => (
          <div key={workout.id}>
            <span className="template-code template-code--small">{workout.templateCode}</span>
            <div><strong>{workout.templateName}</strong><small>{formatLongDate(workout.date)}{workout.duration ? ` · ${workout.duration} min` : ''}</small></div>
            <span>{workout.exercises.filter((exercise) => !exercise.skipped && exercise.sets.length).length} ćwiczeń</span>
            <button className="icon-button icon-button--danger" onClick={() => window.confirm('Usunąć ten trening?') && onDelete(workout.id)} aria-label="Usuń trening"><Trash2 size={16} /></button>
          </div>
        ))}</div> : <p className="workout-history__empty">Brak zapisanych treningów.</p>
      )}
    </section>
  )
}

function ExerciseHistoryModal({ name, workouts, onClose }: { name: string; workouts: Workout[]; onClose: () => void }) {
  const history = useMemo(() => [...workouts]
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((workout) => workout.exercises.filter((exercise) => exercise.name === name && !exercise.skipped).map((exercise) => ({ workout, exercise })))
    .filter((item) => item.exercise.sets.length), [name, workouts])
  const chartData = history.map(({ workout, exercise }) => {
    const top = bestSet(exercise)
    return { date: workout.date, label: workout.date.slice(5).replace('-', '.'), weight: top?.weight, reps: top?.reps }
  }).filter((item) => item.weight !== undefined)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal card exercise-history-modal" role="dialog" aria-modal="true" aria-label={`Historia: ${name}`} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="section-kicker">HISTORIA ĆWICZENIA</span><h2>{name}</h2></div><button className="icon-button" onClick={onClose}><X size={20} /></button></header>
        {history.length ? (
          <>
            <div className="exercise-history-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="#252a2f" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="#6f767d" tickLine={false} axisLine={false} />
                  <YAxis domain={['dataMin - 5', 'dataMax + 5']} stroke="#6f767d" tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#171a1e', border: '1px solid #30353a', borderRadius: 8 }} formatter={(value, key) => [key === 'weight' ? `${value ?? '—'} kg` : value ?? '—', key === 'weight' ? 'Najlepsza seria' : 'Powtórzenia']} />
                  <Line type="monotone" dataKey="weight" stroke="#b8f24a" strokeWidth={2.5} dot={{ r: 3, fill: '#b8f24a' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Data</th><th>Serie: ciężar × powt. · RIR</th><th>Najlepsza</th></tr></thead>
                <tbody>{[...history].reverse().map(({ workout, exercise }) => {
                  const top = bestSet(exercise)
                  return <tr key={`${workout.id}-${exercise.id}`}><td><strong>{formatLongDate(workout.date)}</strong></td><td>{exercise.sets.map((set) => `${set.weight ?? '—'} × ${set.reps ?? '—'} · ${set.rir ?? '—'}`).join('  |  ')}</td><td>{top ? `${top.weight} kg × ${top.reps}` : '—'}</td></tr>
                })}</tbody>
              </table>
            </div>
          </>
        ) : <div className="history-empty"><BarChart3 size={25} /><p>Brak zapisanych wyników dla tego ćwiczenia.</p></div>}
      </section>
    </div>
  )
}
