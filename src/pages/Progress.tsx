import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Dumbbell, MapPin } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../context/AppContext'
import type { Workout, WorkoutExercise, WorkoutSet } from '../types'
import { daysAgoIso, formatLongDate } from '../utils/date'
import { formatDecimal } from '../utils/numbers'
import { formatGymName, formatSet, getBestSet, isEquipmentSensitive } from '../utils/workoutProgress'

type ProgressMetric = 'weight' | 'reps' | 'estimated'
type ProgressRange = '30' | '90' | '180' | 'all'

interface ProgressOccurrence {
  workout: Workout
  exercise: WorkoutExercise
  bestSet: WorkoutSet
}

const ALL_GYMS = '__all__'
const MISSING_GYM = '__missing__'
const gymToken = (name: string) => `gym:${encodeURIComponent(name)}`
const gymFromToken = (token: string) => token.startsWith('gym:') ? decodeURIComponent(token.slice(4)) : undefined
const completeSet = (set: WorkoutSet) => Number.isFinite(set.weight) && Number.isFinite(set.reps)
const estimatedResult = (set: WorkoutSet) => (set.weight ?? 0) * (1 + (set.reps ?? 0) / 30)
const metricValue = (set: WorkoutSet, metric: ProgressMetric) => metric === 'weight' ? set.weight : metric === 'reps' ? set.reps : estimatedResult(set)
const SERIES_COLORS = ['#30d158', '#2997ff', '#b8bec3', '#6f767d', '#7c9cff']

export function Progress({ onOpenWorkout }: { onOpenWorkout: (id: string) => void }) {
  const { data } = useApp()
  const exercises = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; equipmentSensitive: boolean }>()
    ;[...data.workouts].sort((a, b) => b.date.localeCompare(a.date)).forEach((workout) => workout.exercises.forEach((exercise) => {
      const current = byId.get(exercise.id)
      byId.set(exercise.id, { id: exercise.id, name: current?.name ?? exercise.name, equipmentSensitive: Boolean(current?.equipmentSensitive || isEquipmentSensitive(exercise)) })
    }))
    data.templates.forEach((template) => template.exercises.forEach((exercise) => {
      const current = byId.get(exercise.id)
      byId.set(exercise.id, { id: exercise.id, name: exercise.name, equipmentSensitive: Boolean(current?.equipmentSensitive || exercise.equipmentSensitive || isEquipmentSensitive({ ...exercise, sets: [] })) })
    }))
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl'))
  }, [data.templates, data.workouts])

  const [exerciseId, setExerciseId] = useState(() => exercises.find((exercise) => exercise.id === 'bench-press')?.id ?? exercises[0]?.id ?? '')
  const [metric, setMetric] = useState<ProgressMetric>('weight')
  const [range, setRange] = useState<ProgressRange>('90')
  const [gymFilter, setGymFilter] = useState(ALL_GYMS)
  const selectedExercise = exercises.find((exercise) => exercise.id === exerciseId) ?? exercises[0]

  useEffect(() => {
    if (!selectedExercise && exercises[0]) setExerciseId(exercises[0].id)
  }, [exercises, selectedExercise])

  const allOccurrences = useMemo<ProgressOccurrence[]>(() => data.workouts
    .flatMap((workout) => workout.exercises
      .filter((exercise) => exercise.id === selectedExercise?.id && !exercise.skipped)
      .map((exercise) => ({ workout, exercise, bestSet: getBestSet(exercise) })))
    .filter((item): item is ProgressOccurrence => Boolean(item.bestSet && item.exercise.sets.some(completeSet)))
    .sort((a, b) => a.workout.date.localeCompare(b.workout.date)), [data.workouts, selectedExercise?.id])

  const occurrenceGymNames = useMemo(() => [...new Set(
    allOccurrences.map((item) => item.workout.gymLocation?.trim()).filter((name): name is string => Boolean(name)),
  )], [allOccurrences])
  const gymNames = useMemo(() => [...new Set([
    ...(data.settings.gymLocations ?? []),
    ...occurrenceGymNames,
  ])], [occurrenceGymNames, data.settings.gymLocations])
  const hasMissingGym = allOccurrences.some((item) => !item.workout.gymLocation?.trim())

  useEffect(() => {
    if (!selectedExercise?.equipmentSensitive) {
      setGymFilter(ALL_GYMS)
      return
    }
    const currentGym = gymFromToken(gymFilter)
    if (currentGym && occurrenceGymNames.includes(currentGym)) return
    const preferred = data.settings.lastGymLocation && occurrenceGymNames.includes(data.settings.lastGymLocation)
      ? data.settings.lastGymLocation
      : occurrenceGymNames[0] ?? (data.settings.lastGymLocation && gymNames.includes(data.settings.lastGymLocation) ? data.settings.lastGymLocation : gymNames[0])
    setGymFilter(preferred ? gymToken(preferred) : ALL_GYMS)
  }, [selectedExercise?.id, selectedExercise?.equipmentSensitive, occurrenceGymNames.join('|'), gymNames.join('|'), data.settings.lastGymLocation])

  const cutoff = range === 'all' ? undefined : daysAgoIso(Number(range) - 1)
  const selectedGym = gymFromToken(gymFilter)
  const occurrences = allOccurrences.filter((item) => {
    if (cutoff && item.workout.date < cutoff) return false
    if (!selectedExercise?.equipmentSensitive || gymFilter === ALL_GYMS) return true
    if (gymFilter === MISSING_GYM) return !item.workout.gymLocation?.trim()
    return item.workout.gymLocation?.trim() === selectedGym
  })
  const displayedGymSeries = [...new Map(occurrences.map((item) => {
    const gym = item.workout.gymLocation?.trim()
    const identity = gym || MISSING_GYM
    return [identity, { identity, label: gym || 'Nie podano' }]
  })).values()].map((gym, index) => ({ ...gym, key: `gym_${index}` }))
  const chartData = occurrences.map((occurrence, index) => ({
    index,
    date: occurrence.workout.date,
    label: occurrence.workout.date.slice(5).replace('-', '.'),
    value: metricValue(occurrence.bestSet, metric),
    occurrence,
    ...(selectedExercise?.equipmentSensitive && gymFilter === ALL_GYMS
      ? { [displayedGymSeries.find((gym) => gym.identity === (occurrence.workout.gymLocation?.trim() || MISSING_GYM))!.key]: metricValue(occurrence.bestSet, metric) }
      : {}),
  }))
  const values = chartData.map((item) => item.value).filter((value): value is number => typeof value === 'number')
  const minimum = values.length ? Math.min(...values) : 0
  const maximum = values.length ? Math.max(...values) : 1
  const margin = metric === 'reps' ? Math.max(1, (maximum - minimum) * 0.15) : Math.max(0.5, (maximum - minimum) * 0.15, maximum * 0.025)
  const yDomain: [number, number] = [Math.max(0, minimum - margin), maximum + margin]
  const latest = occurrences[occurrences.length - 1]
  const best = [...occurrences].sort((a, b) => estimatedResult(b.bestSet) - estimatedResult(a.bestSet))[0]

  return <div className="page progress-page">
    <PageHeader eyebrow="HISTORIA ĆWICZEŃ" title="Progres" description="Analizuj konkretne ćwiczenie w czasie, bez mieszania wyników z różnych maszyn." />

    <section className="card progress-controls">
      <label className="field"><span>Ćwiczenie</span><select value={selectedExercise?.id ?? ''} onChange={(event) => setExerciseId(event.target.value)}>{exercises.map((exercise) => <option value={exercise.id} key={exercise.id}>{exercise.name}</option>)}</select></label>
      {selectedExercise?.equipmentSensitive && <label className="field"><span>Siłownia</span><select value={gymFilter} onChange={(event) => setGymFilter(event.target.value)}><option value={ALL_GYMS}>Wszystkie siłownie</option>{gymNames.map((gym) => <option value={gymToken(gym)} key={gym}>{gym}</option>)}{hasMissingGym && <option value={MISSING_GYM}>Nie podano</option>}</select></label>}
      <div className="progress-control-group"><span>Wyświetl</span><div className="segmented-control segmented-control--large"><button className={metric === 'weight' ? 'active' : ''} onClick={() => setMetric('weight')}>Ciężar</button><button className={metric === 'reps' ? 'active' : ''} onClick={() => setMetric('reps')}>Powtórzenia</button><button className={metric === 'estimated' ? 'active' : ''} onClick={() => setMetric('estimated')}>Szacowany wynik</button></div></div>
      <div className="progress-control-group"><span>Zakres czasu</span><div className="segmented-control segmented-control--large"><button className={range === '30' ? 'active' : ''} onClick={() => setRange('30')}>30 dni</button><button className={range === '90' ? 'active' : ''} onClick={() => setRange('90')}>90 dni</button><button className={range === '180' ? 'active' : ''} onClick={() => setRange('180')}>6 miesięcy</button><button className={range === 'all' ? 'active' : ''} onClick={() => setRange('all')}>Całość</button></div></div>
    </section>

    {selectedExercise && <>
      <section className="progress-summary">
        <article><span>OSTATNIO</span><strong>{latest ? formatSet(latest.bestSet) : '—'}</strong><small>{latest ? formatLongDate(latest.workout.date) : 'brak danych'}</small></article>
        <article><span>NAJLEPSZY WYNIK</span><strong>{best ? formatSet(best.bestSet) : '—'}</strong><small>{best ? formatLongDate(best.workout.date) : 'brak danych'}</small></article>
        <article><span>TRENINGÓW</span><strong>{occurrences.length}</strong><small>{selectedExercise.equipmentSensitive && selectedGym ? selectedGym : range === 'all' ? 'w całej historii' : `ostatnie ${range} dni`}</small></article>
      </section>

      <section className="card progress-chart-card">
        <div className="card-heading"><div><span className="section-kicker">TREND</span><h2>{selectedExercise.name}</h2></div>{selectedExercise.equipmentSensitive && <span className="equipment-badge"><MapPin size={13} /> Wynik zależny od siłowni</span>}</div>
        {selectedExercise.equipmentSensitive && gymFilter === ALL_GYMS && displayedGymSeries.length > 1 && <><p className="progress-gym-warning">Wyniki z różnych siłowni mogą nie być bezpośrednio porównywalne. Każda siłownia ma osobną linię.</p><div className="progress-series-legend">{displayedGymSeries.map((gym, index) => <span key={gym.key}><i style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />{gym.label}</span>)}</div></>}
        {chartData.length ? <div className="progress-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 18, right: 18, left: 0, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,.055)" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" stroke="#6f767d" tickLine={false} axisLine={false} minTickGap={28} /><YAxis domain={yDomain} stroke="#6f767d" tickLine={false} axisLine={false} width={55} tickFormatter={(value) => formatDecimal(Number(value), metric === 'reps' ? 0 : 2)} /><Tooltip content={<ProgressTooltip metric={metric} />} cursor={{ stroke: 'rgba(255,255,255,.12)', strokeDasharray: '3 3' }} />{selectedExercise.equipmentSensitive && gymFilter === ALL_GYMS ? displayedGymSeries.map((gym, index) => <Line key={gym.key} type="monotone" dataKey={gym.key} name={gym.label} stroke={SERIES_COLORS[index % SERIES_COLORS.length]} strokeWidth={2.4} dot={{ r: 3.5, fill: SERIES_COLORS[index % SERIES_COLORS.length], strokeWidth: 0 }} connectNulls />) : <Line type="monotone" dataKey="value" stroke="#30d158" strokeWidth={2.7} dot={{ r: 3.5, fill: '#30d158', strokeWidth: 0 }} />}</LineChart></ResponsiveContainer></div> : <EmptyState icon={BarChart3} title="Brak wyników w tym zakresie" description="Zapisz serie tego ćwiczenia albo wybierz dłuższy zakres czasu." />}
      </section>

      <section className="card progress-history"><div className="card-heading"><div><span className="section-kicker">SZCZEGÓŁY</span><h2>Historia ćwiczenia</h2></div><strong>{occurrences.length}</strong></div>{occurrences.length ? <div className="progress-history__list">{[...occurrences].reverse().map((occurrence) => <button type="button" key={`${occurrence.workout.id}-${occurrence.exercise.id}`} onClick={() => onOpenWorkout(occurrence.workout.id)}><div><strong>{formatLongDate(occurrence.workout.date)}</strong>{selectedExercise.equipmentSensitive && <small><MapPin size={12} /> {formatGymName(occurrence.workout.gymLocation)}</small>}</div><span>{occurrence.exercise.sets.filter(completeSet).map(formatSet).join('   ')}</span><small>Zobacz trening</small></button>)}</div> : <div className="history-empty"><Dumbbell size={22} /><p>Jeszcze brak historii</p><span>Wyniki pojawią się tutaj po zapisaniu treningu.</span></div>}</section>
    </>}
  </div>
}

function ProgressTooltip({ active, payload, metric }: { active?: boolean; payload?: Array<{ payload?: { occurrence?: ProgressOccurrence } }>; metric: ProgressMetric }) {
  const occurrence = payload?.find((item) => item.payload?.occurrence)?.payload?.occurrence
  if (!active || !occurrence) return null
  return <div className="chart-tooltip progress-tooltip"><strong>{formatLongDate(occurrence.workout.date)}</strong><span>{occurrence.exercise.name}</span><small>{formatGymName(occurrence.workout.gymLocation)}</small><div>{occurrence.exercise.sets.filter(completeSet).map((set, index) => <p key={set.id}>{index + 1}. {formatSet(set)}</p>)}</div>{metric === 'estimated' && <em>Szacowany wynik: {formatDecimal(estimatedResult(occurrence.bestSet))}</em>}</div>
}
