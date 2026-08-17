import { useMemo, useState } from 'react'
import {
  Check,
  Clipboard,
  Dumbbell,
  Expand,
  Footprints,
  Minimize2,
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
import { WeightTooltip } from '../components/ChartTooltip'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../context/AppContext'
import type { WorkoutExercise, WorkoutSet } from '../types'
import {
  average,
  entriesBetween,
  formatInteger,
  formatNumber,
  latestMeasurement,
  signed,
  waistChange,
  weightChartData,
  windowFor,
  workoutsBetween,
} from '../utils/calculations'
import { formatLongDate, formatShortDate, isoToday } from '../utils/date'

type Period = '7' | '14' | 'custom'

const keyExercises = [
  { label: 'Bench Press', match: (name: string) => name === 'Bench Press' },
  { label: 'Incline DB Press', match: (name: string) => name === 'Incline Dumbbell Press' },
  { label: 'Pull-Up', match: (name: string) => name.startsWith('Pull-Up') },
  { label: 'Chest-Supported Row', match: (name: string) => name === 'Chest-Supported Row' },
  { label: 'Romanian Deadlift', match: (name: string) => name === 'Romanian Deadlift' },
  { label: 'Hack Squat', match: (name: string) => name.startsWith('Hack Squat') },
  { label: 'Lateral Raise', match: (name: string) => name.startsWith('Lateral Raise') },
]

const topSet = (exercise: WorkoutExercise): WorkoutSet | undefined =>
  exercise.sets
    .filter((set) => set.weight !== undefined && set.reps !== undefined)
    .sort((a, b) => ((b.weight ?? 0) * (b.reps ?? 0)) - ((a.weight ?? 0) * (a.reps ?? 0)))[0]

const setLabel = (set?: WorkoutSet) => set ? `${formatNumber(set.weight)} kg × ${set.reps ?? '—'}` : '—'

const setChange = (current?: WorkoutSet, previous?: WorkoutSet) => {
  if (!current || !previous) return '—'
  const weightDelta = (current.weight ?? 0) - (previous.weight ?? 0)
  if (weightDelta !== 0) return `${weightDelta > 0 ? '+' : ''}${formatNumber(weightDelta)} kg`
  const repsDelta = (current.reps ?? 0) - (previous.reps ?? 0)
  return repsDelta === 0 ? 'bez zmiany' : `${repsDelta > 0 ? '+' : ''}${repsDelta} powt.`
}

export function CoachReport() {
  const { data } = useApp()
  const today = isoToday()
  const [period, setPeriod] = useState<Period>('7')
  const [customFrom, setCustomFrom] = useState(windowFor(today, 7).from)
  const [customTo, setCustomTo] = useState(today)
  const [copied, setCopied] = useState(false)
  const [screenshotMode, setScreenshotMode] = useState(false)

  const range = period === 'custom' ? { from: customFrom, to: customTo } : windowFor(today, Number(period))
  const periodEntries = entriesBetween(data.dailyEntries, range.from, range.to)
  const periodWorkouts = workoutsBetween(data.workouts, range.from, range.to)
  const currentSeven = entriesBetween(data.dailyEntries, windowFor(range.to, 7).from, range.to)
  const previousSevenRange = windowFor(range.to, 7, 7)
  const previousSeven = entriesBetween(data.dailyEntries, previousSevenRange.from, previousSevenRange.to)
  const currentWeight = average(currentSeven.map((entry) => entry.weight))
  const previousWeight = average(previousSeven.map((entry) => entry.weight))
  const weightDelta = currentWeight !== undefined && previousWeight !== undefined ? currentWeight - previousWeight : undefined
  const latestWaist = latestMeasurement(data.dailyEntries.filter((entry) => entry.date <= range.to), 'waist')
  const waistDelta = waistChange(data.dailyEntries.filter((entry) => entry.date <= range.to))
  const calories = average(periodEntries.map((entry) => entry.calories))
  const protein = average(periodEntries.map((entry) => entry.protein))
  const steps = average(periodEntries.map((entry) => entry.steps))
  const recovery = average(periodEntries.map((entry) => entry.recovery))

  const weightData = useMemo(
    () => weightChartData(data.dailyEntries, range.from, range.to),
    [data.dailyEntries, range.from, range.to],
  )
  const waistData = useMemo(() => periodEntries
    .filter((entry) => typeof entry.waist === 'number')
    .map((entry) => ({ date: entry.date, label: entry.date.slice(5).replace('-', '.'), waist: entry.waist })), [periodEntries])

  const exerciseRows = keyExercises.map((keyExercise) => {
    const occurrences = [...data.workouts]
      .filter((workout) => workout.date <= range.to)
      .sort((a, b) => b.date.localeCompare(a.date))
      .flatMap((workout) => workout.exercises
        .filter((exercise) => keyExercise.match(exercise.name) && !exercise.skipped && exercise.sets.length)
        .map((exercise) => ({ workout, exercise })))
    return { label: keyExercise.label, current: occurrences[0], previous: occurrences[1] }
  })

  const reportText = [
    `Okres: ${formatShortDate(range.from)}–${formatShortDate(range.to)}`,
    `Faza: ${data.settings.phase}`,
    `Średnia masa: ${formatNumber(currentWeight)} kg`,
    `Zmiana vs poprzednie 7 dni: ${signed(weightDelta, ' kg')}`,
    `Talia: ${formatNumber(latestWaist?.waist)} cm`,
    `Średnie kcal: ${formatInteger(calories)} kcal`,
    `Białko: ${formatInteger(protein)} g`,
    `Kroki: ${formatInteger(steps)}`,
    `Treningi: ${periodWorkouts.length}`,
    `Regeneracja: ${formatNumber(recovery)}/10`,
  ].join('\n')

  const copyReport = async () => {
    await navigator.clipboard.writeText(reportText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2200)
  }

  return (
    <div className={`page coach-page ${screenshotMode ? 'coach-page--screenshot' : ''}`}>
      <PageHeader
        eyebrow="DLA TRENERA"
        title="Coach Report"
        description="Pełny obraz okresu w kompaktowym układzie gotowym do zrzutu ekranu."
        actions={<button className="button button--ghost" onClick={() => setScreenshotMode((current) => !current)}>{screenshotMode ? <Minimize2 size={17} /> : <Expand size={17} />} {screenshotMode ? 'Zwykły widok' : 'Tryb zrzutu'}</button>}
      />

      <div className="report-controls">
        <div className="segmented-control segmented-control--large">
          <button className={period === '7' ? 'active' : ''} onClick={() => setPeriod('7')}>7 dni</button>
          <button className={period === '14' ? 'active' : ''} onClick={() => setPeriod('14')}>14 dni</button>
          <button className={period === 'custom' ? 'active' : ''} onClick={() => setPeriod('custom')}>Własny zakres</button>
        </div>
        {period === 'custom' && <div className="custom-range"><label>Od <input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>Do <input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}
      </div>

      <section className="report-sheet">
        <header className="report-sheet__header">
          <div><span className="section-kicker">FORMLOG · RAPORT OKRESOWY</span><h2>{formatLongDate(range.from)} — {formatLongDate(range.to)}</h2></div>
          <div className="report-phase"><span>FAZA</span><strong>{data.settings.phase}</strong><small>Cel: {data.settings.calorieTarget.toLocaleString('pl-PL')} kcal · {data.settings.proteinTarget} g białka</small></div>
        </header>

        <div className="report-stats">
          <ReportStat icon={Scale} label="Masa 7 dni" value={`${formatNumber(currentWeight)} kg`} sub={`poprz. ${formatNumber(previousWeight)} kg`} />
          <ReportStat icon={Scale} label="Zmiana masy" value={signed(weightDelta, ' kg')} sub="7 dni vs 7 dni" tone={weightDelta} />
          <ReportStat icon={Ruler} label="Ostatnia talia" value={`${formatNumber(latestWaist?.waist)} cm`} sub={`${signed(waistDelta, ' cm')} vs poprzedni`} />
          <ReportStat icon={Utensils} label="Średnie kcal" value={`${formatInteger(calories)} kcal`} sub={`cel ${data.settings.calorieTarget.toLocaleString('pl-PL')}`} />
          <ReportStat icon={Utensils} label="Średnie białko" value={`${formatInteger(protein)} g`} sub={`cel ${data.settings.proteinTarget} g`} />
          <ReportStat icon={Footprints} label="Średnie kroki" value={formatInteger(steps)} sub="dni z wpisem" />
          <ReportStat icon={Dumbbell} label="Treningi" value={String(periodWorkouts.length)} sub={`${period === 'custom' ? periodEntries.length : period} dni`} />
          <ReportStat icon={Check} label="Regeneracja" value={`${formatNumber(recovery)}/10`} sub="średnia z wpisów" />
        </div>

        <div className="report-charts">
          <article>
            <div className="mini-heading"><div><span className="section-kicker">TREND</span><h3>Masa ciała</h3></div><div className="chart-legend"><span><i className="legend-weight" /> Dzienna</span><span><i className="legend-average" /> Śr. 7 dni</span></div></div>
            <div className="report-chart report-chart--weight">
              {weightData.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={weightData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#252a2f" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value) => value.slice(5).replace('-', '.')} stroke="#6f767d" tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis domain={[(min: number) => Math.floor((min - 1) * 2) / 2, (max: number) => Math.ceil((max + 1) * 2) / 2]} stroke="#6f767d" tickLine={false} axisLine={false} />
                <Tooltip content={<WeightTooltip />} />
                <Line type="monotone" dataKey="weight" stroke="#778087" strokeWidth={1.2} dot={{ r: 2, fill: '#778087' }} />
                <Line type="monotone" dataKey="movingAverage" stroke="#b8f24a" strokeWidth={2.7} dot={false} />
              </LineChart></ResponsiveContainer> : <p className="report-chart__empty">Brak pomiarów masy w tym okresie.</p>}
            </div>
          </article>
          <article>
            <div className="mini-heading"><div><span className="section-kicker">POMIARY</span><h3>Talia</h3></div><strong>{formatNumber(latestWaist?.waist)} cm</strong></div>
            <div className="report-chart report-chart--waist">
              {waistData.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={waistData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs><linearGradient id="reportWaistArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b8f24a" stopOpacity={0.2} /><stop offset="100%" stopColor="#b8f24a" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="#252a2f" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="#6f767d" tickLine={false} axisLine={false} />
                <YAxis domain={['dataMin - 1', 'dataMax + 1']} stroke="#6f767d" tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#171a1e', border: '1px solid #30353a', borderRadius: 8 }} formatter={(value) => [`${formatNumber(Number(value ?? 0))} cm`, 'Talia']} />
                <Area type="monotone" dataKey="waist" stroke="#b8f24a" strokeWidth={2.2} fill="url(#reportWaistArea)" dot={{ r: 2.5, fill: '#b8f24a' }} />
              </AreaChart></ResponsiveContainer> : <p className="report-chart__empty">Brak pomiarów talii w tym okresie.</p>}
            </div>
          </article>
        </div>

        <div className="report-lower">
          <article className="report-workouts">
            <div className="mini-heading"><div><span className="section-kicker">WYKONANE SESJE</span><h3>Treningi</h3></div><strong>{periodWorkouts.length}</strong></div>
            {periodWorkouts.length ? <div className="report-workout-list">{periodWorkouts.map((workout) => (
              <div key={workout.id}><span className="template-code template-code--small">{workout.templateCode}</span><strong>{formatShortDate(workout.date)}</strong><p>{workout.templateName}</p><small>{workout.duration ? `${workout.duration} min` : 'czas —'}</small></div>
            ))}</div> : <p className="report-list-empty">Brak treningów w wybranym okresie.</p>}
          </article>

          <article className="report-exercises">
            <div className="mini-heading"><div><span className="section-kicker">PROGRES</span><h3>Najważniejsze ćwiczenia</h3></div></div>
            <div className="table-scroll">
              <table className="data-table report-exercise-table">
                <thead><tr><th>Ćwiczenie</th><th>Poprzednio</th><th>Ostatnio</th><th>Zmiana</th></tr></thead>
                <tbody>{exerciseRows.map((row) => {
                  const currentSet = row.current ? topSet(row.current.exercise) : undefined
                  const previousSet = row.previous ? topSet(row.previous.exercise) : undefined
                  return <tr key={row.label}>
                    <td><strong>{row.label}</strong></td>
                    <td>{setLabel(previousSet)}{row.previous && <small>{formatShortDate(row.previous.workout.date)}</small>}</td>
                    <td>{setLabel(currentSet)}{row.current && <small>{formatShortDate(row.current.workout.date)}</small>}</td>
                    <td><span className={currentSet && previousSet ? 'change-pill' : 'muted'}>{setChange(currentSet, previousSet)}</span></td>
                  </tr>
                })}</tbody>
              </table>
            </div>
          </article>
        </div>

        <article className="report-copy">
          <pre>{reportText}</pre>
          <button className={`button ${copied ? 'button--success' : 'button--primary'}`} onClick={copyReport}>{copied ? <Check size={17} /> : <Clipboard size={17} />} {copied ? 'Skopiowano' : 'Kopiuj raport'}</button>
        </article>
      </section>
    </div>
  )
}

function ReportStat({ icon: Icon, label, value, sub, tone }: { icon: typeof Scale; label: string; value: string; sub: string; tone?: number }) {
  return <div className="report-stat"><div><Icon size={15} /><span>{label}</span></div><strong className={tone === undefined ? '' : tone > 0 ? 'value-up' : tone < 0 ? 'value-down' : ''}>{value}</strong><small>{sub}</small></div>
}
