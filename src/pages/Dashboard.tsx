import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  BatteryCharging,
  ChevronDown,
  Dumbbell,
  Footprints,
  Gauge,
  NotebookPen,
  Play,
  Ruler,
  Scale,
  Utensils,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { View } from '../App'
import { EmptyState } from '../components/EmptyState'
import { WeightTooltip } from '../components/ChartTooltip'
import { useApp } from '../context/AppContext'
import type { Phase, WorkoutExercise } from '../types'
import {
  average,
  entriesBetween,
  formatInteger,
  formatNumber,
  latestMeasurement,
  signed,
  weightChartData,
  windowFor,
} from '../utils/calculations'
import { daysAgoIso, formatLongDate, isoToday } from '../utils/date'

type Range = '30' | '90' | 'all'
const phases: Phase[] = ['Maintenance', 'Lean Gain', 'Mini Cut', 'Redukcja']

const bestSet = (exercise: WorkoutExercise) => exercise.sets
  .filter((set) => set.weight !== undefined && set.reps !== undefined)
  .sort((a, b) => ((b.weight ?? 0) * (b.reps ?? 0)) - ((a.weight ?? 0) * (a.reps ?? 0)))[0]

export function Dashboard({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { data, updateSettings } = useApp()
  const [range, setRange] = useState<Range>('30')
  const [phaseOpen, setPhaseOpen] = useState(false)
  const today = isoToday()
  const currentWindow = windowFor(today, 7)
  const previousWindow = windowFor(today, 7, 7)
  const currentEntries = entriesBetween(data.dailyEntries, currentWindow.from, currentWindow.to)
  const previousEntries = entriesBetween(data.dailyEntries, previousWindow.from, previousWindow.to)

  const currentWeight = average(currentEntries.map((entry) => entry.weight))
  const previousWeight = average(previousEntries.map((entry) => entry.weight))
  const weightDelta = currentWeight !== undefined && previousWeight !== undefined ? currentWeight - previousWeight : undefined
  const calories = average(currentEntries.map((entry) => entry.calories))
  const protein = average(currentEntries.map((entry) => entry.protein))
  const steps = average(currentEntries.map((entry) => entry.steps))
  const recovery = average(currentEntries.map((entry) => entry.recovery))
  const latestWaist = latestMeasurement(data.dailyEntries, 'waist')
  const recentWorkouts = data.workouts.filter((workout) => workout.date >= currentWindow.from && workout.date <= currentWindow.to)

  const chartFrom = range === 'all' ? undefined : daysAgoIso(Number(range) - 1)
  const chartData = useMemo(() => weightChartData(data.dailyEntries, chartFrom, today), [data.dailyEntries, chartFrom, today])
  const waistData = useMemo(() => [...data.dailyEntries]
    .filter((entry) => typeof entry.waist === 'number' && (!chartFrom || entry.date >= chartFrom))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({ date: entry.date, label: entry.date.slice(5).replace('-', '.'), waist: entry.waist })), [data.dailyEntries, chartFrom])

  const lastWorkout = [...data.workouts].sort((a, b) => b.date.localeCompare(a.date))[0]
  const templateIndex = lastWorkout ? data.templates.findIndex((template) => template.id === lastWorkout.templateId) : -1
  const nextTemplate = data.templates[(templateIndex + 1 + data.templates.length) % data.templates.length] ?? data.templates[0]
  const completedLastExercises = lastWorkout?.exercises.filter((exercise) => !exercise.skipped && bestSet(exercise)) ?? []
  const priorityExercises = completedLastExercises.filter((exercise) => /bench|incline|pull-up|chest-supported|hack squat|romanian|lateral raise/i.test(exercise.name))
  const lastHighlights = [...priorityExercises, ...completedLastExercises.filter((exercise) => !priorityExercises.includes(exercise))]
    .slice(0, 3)
    .map((exercise) => ({ name: exercise.name, set: bestSet(exercise)! }))

  const friendlyDate = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${today}T12:00:00`))

  return (
    <div className="page dashboard-page dashboard-v2">
      <header className="dashboard-hero">
        <div>
          <span className="eyebrow">FORMLOG</span>
          <p>{friendlyDate.charAt(0).toUpperCase() + friendlyDate.slice(1)}</p>
          <h1>Twój progres</h1>
        </div>
        <div className="dashboard-hero__actions">
          <button className="button button--ghost" onClick={() => onNavigate('journal')}><NotebookPen size={17} /> Dodaj wpis</button>
          <button className="button button--primary" onClick={() => onNavigate('training')}><Play size={16} fill="currentColor" /> Rozpocznij trening</button>
        </div>
      </header>

      <section className="phase-bar">
        <div className="phase-control">
          <button className="phase-status" onClick={() => setPhaseOpen((current) => !current)} aria-expanded={phaseOpen}>
            <i /> <span>{data.settings.phase}</span> <ChevronDown size={14} />
          </button>
          {phaseOpen && (
            <div className="phase-menu">
              {phases.map((phase) => <button key={phase} className={data.settings.phase === phase ? 'active' : ''} onClick={() => { updateSettings({ phase }); setPhaseOpen(false) }}>{phase}</button>)}
            </div>
          )}
        </div>
        <span className="phase-divider" />
        <label className="calorie-status"><input aria-label="Cel kalorii" type="number" inputMode="numeric" value={data.settings.calorieTarget} onChange={(event) => updateSettings({ calorieTarget: Number(event.target.value) })} /><span>kcal</span></label>
        <small>aktualny dzienny cel</small>
      </section>

      <section className="primary-metrics">
        <article className="primary-metric">
          <div><span>Masa</span><Scale size={18} /></div>
          <strong>{formatNumber(currentWeight)} <small>kg</small></strong>
          <p>{signed(weightDelta, ' kg')} vs poprzednie 7 dni</p>
        </article>
        <article className="primary-metric">
          <div><span>Talia</span><Ruler size={18} /></div>
          <strong>{formatNumber(latestWaist?.waist)} <small>cm</small></strong>
          <p>{latestWaist ? `pomiar ${formatLongDate(latestWaist.date)}` : 'jeszcze bez pomiaru'}</p>
        </article>
        <article className="primary-metric">
          <div><span>Kalorie</span><Utensils size={18} /></div>
          <strong>{formatInteger(calories)}</strong>
          <p>cel {data.settings.calorieTarget.toLocaleString('pl-PL')} kcal</p>
        </article>
        <article className="primary-metric">
          <div><span>Treningi</span><Dumbbell size={18} /></div>
          <strong>{recentWorkouts.length}</strong>
          <p>ostatnie 7 dni</p>
        </article>
      </section>

      <section className="secondary-metrics">
        <div><Gauge size={16} /><span>Białko</span><strong>{formatInteger(protein)} g</strong><small>cel {data.settings.proteinTarget} g</small></div>
        <div><Footprints size={16} /><span>Kroki</span><strong>{formatInteger(steps)}</strong><small>średnio / dzień</small></div>
        <div><BatteryCharging size={16} /><span>Regeneracja</span><strong>{formatNumber(recovery)}/10</strong><small>średnia 7 dni</small></div>
      </section>

      <section className="dashboard-focus-grid">
        <article className="card chart-card chart-card--weight">
          <div className="card-heading">
            <div><span className="section-kicker">TREND</span><h2>Masa ciała</h2></div>
            <div className="segmented-control" aria-label="Zakres wykresu">
              {(['30', '90', 'all'] as const).map((option) => <button key={option} className={range === option ? 'active' : ''} onClick={() => setRange(option)}>{option === 'all' ? 'Całość' : `${option} dni`}</button>)}
            </div>
          </div>
          {chartData.length ? (
            <div className="chart chart--hero">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 18, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.055)" strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(value) => value.slice(5).replace('-', '.')} stroke="#6f767d" tickLine={false} axisLine={false} minTickGap={32} />
                  <YAxis domain={[(min: number) => Math.floor((min - 0.75) * 2) / 2, (max: number) => Math.ceil((max + 0.75) * 2) / 2]} stroke="#6f767d" tickLine={false} axisLine={false} tickFormatter={(value) => value.toFixed(1)} width={48} />
                  <Tooltip content={<WeightTooltip />} cursor={{ stroke: 'rgba(255,255,255,.12)', strokeDasharray: '3 3' }} />
                  <Line type="monotone" dataKey="weight" stroke="#737a80" strokeWidth={1.25} dot={{ r: 2.4, fill: '#8b9298', strokeWidth: 0 }} activeDot={{ r: 4.5, fill: '#d9dde0', stroke: '#111416', strokeWidth: 2 }} connectNulls />
                  <Line type="monotone" dataKey="movingAverage" stroke="#2997ff" strokeWidth={2.8} dot={false} activeDot={{ r: 4, fill: '#2997ff', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState icon={Scale} title="Jeszcze brak danych" description="Dodaj pierwszy pomiar, aby zobaczyć trend masy." action={<button className="button button--ghost button--small" onClick={() => onNavigate('journal')}>Dodaj wpis</button>} />}
          {chartData.length > 0 && <div className="chart-legend"><span><i className="legend-weight" /> Masa dzienna</span><span><i className="legend-average" /> Średnia 7 dni</span></div>}
        </article>

        <aside className="workout-insights">
          <article className="card last-workout-card">
            <div className="card-heading"><div><span className="section-kicker">OSTATNIA SESJA</span><h2>Ostatni trening</h2></div><Activity size={18} /></div>
            {lastWorkout ? <>
              <div className="last-workout-card__title"><span className="template-code">{lastWorkout.templateCode}</span><div><strong>{lastWorkout.templateName}</strong><small>{formatLongDate(lastWorkout.date)}{lastWorkout.duration ? ` · ${lastWorkout.duration} min` : ''}</small></div></div>
              <div className="last-results">{lastHighlights.map(({ name, set }) => <div key={name}><span>{name}</span><strong>{formatNumber(set.weight)} × {set.reps}</strong></div>)}</div>
              <button className="link-button" onClick={() => onNavigate('training')}>Zobacz trening <ArrowRight size={15} /></button>
            </> : <div className="compact-empty"><Dumbbell size={20} /><span>Jeszcze nie zapisano treningu.</span></div>}
          </article>

          <article className="card next-workout-card">
            <div><span className="section-kicker">ROLLING SPLIT</span><p>Następny trening</p></div>
            <div className="next-workout-card__main"><span>{nextTemplate.code}</span><div><strong>{nextTemplate.name}</strong><small>{nextTemplate.exercises.length} ćwiczeń</small></div></div>
            <button className="button button--primary button--full" onClick={() => onNavigate('training')}><Play size={15} fill="currentColor" /> Rozpocznij</button>
          </article>
        </aside>
      </section>

      <article className="card waist-card-v2">
        <div className="card-heading"><div><span className="section-kicker">POMIARY</span><h2>Obwód talii</h2></div><strong>{formatNumber(latestWaist?.waist)} <small>cm</small></strong></div>
        {waistData.length ? <div className="chart chart--waist-v2"><ResponsiveContainer width="100%" height="100%"><AreaChart data={waistData} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
          <defs><linearGradient id="waistAreaV2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2997ff" stopOpacity={0.14} /><stop offset="100%" stopColor="#2997ff" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid stroke="rgba(255,255,255,.05)" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" stroke="#6f767d" tickLine={false} axisLine={false} minTickGap={32} />
          <YAxis domain={['dataMin - 1', 'dataMax + 1']} stroke="#6f767d" tickLine={false} axisLine={false} width={45} />
          <Tooltip formatter={(value) => [`${formatNumber(Number(value ?? 0))} cm`, 'Talia']} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ? formatLongDate(payload[0].payload.date) : ''} contentStyle={{ background: '#171a1e', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12 }} />
          <Area type="monotone" dataKey="waist" stroke="#2997ff" strokeWidth={2.2} fill="url(#waistAreaV2)" dot={{ r: 2.7, fill: '#2997ff', strokeWidth: 0 }} />
        </AreaChart></ResponsiveContainer></div> : <EmptyState icon={Ruler} title="Jeszcze brak danych" description="Dodaj pierwszy pomiar talii w dzienniku." />}
      </article>
    </div>
  )
}
