import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, TimerReset } from 'lucide-react'
import { compareSets, formatSet, normalizeDecimalInput, previousExerciseOccurrence, updateWorkout, type Workout, type WorkoutExercise, type WorkoutSet } from '@greekgod/core'
import { useMobileData } from '../context/MobileDataContext'
import { appendWorkoutSet, finalizeWorkout, upsertWorkoutSet } from '../domain/mobileModel'
import { NativeMobileStore, type TimerStatus } from '../services/mobileStore'

const timerText = (status: TimerStatus | undefined, now: number) => {
  if (!status || status.state === 'idle') return 'Start 2:30'
  if (status.state === 'finished' || !status.targetEpochMs) return 'Koniec · uruchom ponownie'
  const seconds = Math.max(0, Math.ceil((status.targetEpochMs - now) / 1_000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

const SetRow = ({ exercise, set, index, previous, save }: {
  exercise: WorkoutExercise
  set: WorkoutSet
  index: number
  previous?: WorkoutSet
  save: (exerciseId: string, setId: string, values: Pick<WorkoutSet, 'weight' | 'reps'>) => Promise<unknown>
}) => {
  const [weight, setWeight] = useState(set.weight?.toString() ?? '')
  const [reps, setReps] = useState(set.reps?.toString() ?? '')
  const [saved, setSaved] = useState(Boolean(set.weight !== undefined && set.reps !== undefined))
  useEffect(() => {
    setWeight(set.weight?.toString() ?? '')
    setReps(set.reps?.toString() ?? '')
    setSaved(Boolean(set.weight !== undefined && set.reps !== undefined))
  }, [set.weight, set.reps])
  const submit = async () => {
    const parsedWeight = normalizeDecimalInput(weight)
    const parsedReps = normalizeDecimalInput(reps)
    if (parsedWeight === undefined || parsedWeight < 0 || parsedReps === undefined || parsedReps <= 0 || !Number.isInteger(parsedReps)) return
    await save(exercise.id, set.id, { weight: parsedWeight, reps: parsedReps })
    setSaved(true)
  }
  const progress = compareSets({ ...set, weight: normalizeDecimalInput(weight), reps: normalizeDecimalInput(reps) }, previous, exercise.prescription)
  return (
    <div className="mobile-set-row">
      <span className="set-number">{index + 1}</span>
      <label><span>KG</span><input inputMode="decimal" value={weight} onChange={(event) => { setWeight(event.target.value); setSaved(false) }} placeholder="—" /></label>
      <label><span>POWT.</span><input inputMode="numeric" value={reps} onChange={(event) => { setReps(event.target.value); setSaved(false) }} placeholder="—" /></label>
      <button className={saved ? 'set-save saved' : 'set-save'} type="button" onClick={submit} aria-label={`Zapisz serię ${index + 1}`}><Check size={19} /></button>
      <small className={`set-progress set-progress--${progress.tone}`}>{progress.label}</small>
    </div>
  )
}

export const WorkoutPage = ({ workoutId, goBack }: { workoutId?: string; goBack: () => void }) => {
  const { data, mutate, saving, isNative, snapshot } = useMobileData()
  const workout = data?.workouts.find((item) => item.id === workoutId)
  const [exerciseIndex, setExerciseIndex] = useState(0)
  const [timer, setTimer] = useState<TimerStatus>()
  const [timerError, setTimerError] = useState<string>()
  const [now, setNow] = useState(Date.now())
  const nativeStore = useMemo(() => isNative ? new NativeMobileStore() : undefined, [isNative])
  const exercise = workout?.exercises[exerciseIndex]
  const previous = useMemo(() => data && workout && exercise ? previousExerciseOccurrence(
    data.workouts.filter((item) => item.id !== workout.id),
    exercise,
    {
      beforeOrOn: workout.date,
      exerciseLibrary: data.exerciseLibrary,
      gymLocation: workout.gymLocation,
    },
  ).comparable : undefined, [data, workout, exercise])
  useEffect(() => {
    if (!nativeStore) return
    void nativeStore.timerStatus().then(setTimer).catch(() => undefined)
  }, [nativeStore])
  useEffect(() => {
    if (timer?.state !== 'running') return
    const interval = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (timer.targetEpochMs && current >= timer.targetEpochMs) {
        void nativeStore?.timerStatus().then(setTimer).catch(() => setTimer((value) => value ? { ...value, state: 'finished' } : value))
      }
    }, 1_000)
    return () => window.clearInterval(interval)
  }, [nativeStore, timer?.state, timer?.targetEpochMs])
  if (!data || !workout || !exercise) return <main className="mobile-page"><button className="back-button" onClick={goBack}><ChevronLeft /> Wróć</button><p>Nie znaleziono aktywnego treningu.</p></main>
  const editWorkout = (updater: (current: Workout) => Workout) => mutate((current) => {
    const latest = current.workouts.find((item) => item.id === workout.id)
    return latest ? { ...current, workouts: updateWorkout(current.workouts, updater(latest)) } : current
  })
  const saveSet = (exerciseId: string, setId: string, values: Pick<WorkoutSet, 'weight' | 'reps'>) =>
    editWorkout((current) => upsertWorkoutSet(current, exerciseId, setId, values))
  const gyms = data.settings.gymLocations ?? []
  const finishWorkout = async () => {
    const latest = data.workouts.find((item) => item.id === workout.id)
    if (!latest) return
    const completed = finalizeWorkout(latest)
    const allowEmpty = completed !== undefined || window.confirm('Brak ukończonych serii. Zapisać ten trening mimo to?')
    if (!allowEmpty) return
    await editWorkout((current) => {
      return finalizeWorkout(current, allowEmpty) ?? current
    })
    goBack()
  }
  const startTimer = async () => {
    if (!nativeStore || !snapshot) return
    const incompleteIndex = exercise.sets.findIndex((set) => set.weight === undefined || set.reps === undefined)
    const targetIndex = incompleteIndex >= 0 ? incompleteIndex : exercise.sets.length - 1
    const targetSet = exercise.sets[targetIndex] ?? exercise.sets.at(-1)
    if (!targetSet) return
    setTimerError(undefined)
    try {
      const next = await nativeStore.startTimer({
        workoutId: workout.id,
        exerciseId: exercise.id,
        setId: targetSet.id,
        templateLabel: `${workout.templateCode} · ${workout.templateName}`,
        exerciseLabel: `${exercise.name} · seria ${targetIndex + 1}/${exercise.sets.length}`,
        previousLabel: formatSet(previous?.exercise.sets[targetIndex]),
        durationSeconds: 150,
      })
      setNow(Date.now())
      setTimer(next)
    } catch {
      setTimerError('Włącz wymagane uprawnienie i naciśnij timer ponownie.')
    }
  }
  return (
    <main className="mobile-page workout-mobile-page">
      <div className="page-toolbar"><button className="icon-button" type="button" onClick={goBack} aria-label="Wróć"><ChevronLeft /></button><div><p className="eyebrow">{workout.templateCode} · {workout.templateName}</p><strong>{workout.date}</strong></div><span className="local-save-state">{saving ? 'Zapis…' : 'Lokalnie ✓'}</span></div>
      <label className="mobile-field compact-field"><span>Siłownia</span><select value={workout.gymLocation ?? ''} onChange={(event) => { const gym = event.target.value || undefined; void editWorkout((current) => ({ ...current, gymLocation: gym })) }}><option value="">Nie podano</option>{gyms.map((gym) => <option key={gym}>{gym}</option>)}</select></label>
      <div className="exercise-pager"><button type="button" disabled={exerciseIndex === 0} onClick={() => setExerciseIndex((value) => value - 1)}>‹</button><span>{exerciseIndex + 1} / {workout.exercises.length}</span><button type="button" disabled={exerciseIndex === workout.exercises.length - 1} onClick={() => setExerciseIndex((value) => value + 1)}>›</button></div>
      <section className="exercise-heading"><p className="card-kicker">{exercise.prescription}</p><h1>{exercise.name}</h1></section>
      <section className="previous-result surface"><p className="card-kicker">Poprzedni porównywalny wynik</p>{previous ? <><strong>{previous.exercise.sets.map(formatSet).join(' · ') || 'Brak pełnych serii'}</strong><small>{previous.workout.date} · {previous.workout.gymLocation ?? 'bez siłowni'}</small></> : <strong>Brak wcześniejszego wyniku</strong>}</section>
      <section className="sets-section">{exercise.sets.map((set, index) => <SetRow key={set.id} exercise={exercise} set={set} index={index} previous={previous?.exercise.sets[index]} save={saveSet} />)}</section>
      <button className="add-set-button" type="button" onClick={() => void editWorkout((current) => appendWorkoutSet(current, exercise.id))}>+ Dodaj serię</button>
      <button className="secondary-button timer-placeholder" type="button" disabled={!isNative} onClick={() => void startTimer()}><TimerReset size={18} /> {isNative ? timerText(timer, now) : 'Timer w aplikacji Android'}</button>
      {timerError && <p className="timer-error">{timerError}</p>}
      <button className="primary-button finish-workout" type="button" disabled={saving} onClick={() => void finishWorkout()}>Zakończ trening</button>
    </main>
  )
}
