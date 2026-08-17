import { useEffect, useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import {
  Activity,
  Check,
  Clipboard,
  Download,
  Dumbbell,
  Expand,
  Footprints,
  LoaderCircle,
  Ruler,
  Scale,
  Utensils,
  X,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { WeightTooltip } from '../components/ChartTooltip'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { savePngDataUrl } from '../services/fileService'
import type { WorkoutExercise, WorkoutSet } from '../types'
import { average, entriesBetween, formatInteger, formatNumber, latestMeasurement, signed, waistChange, weightChartData, windowFor, workoutsBetween } from '../utils/calculations'
import { formatLongDate, formatShortDate, isoToday, parseDate } from '../utils/date'

type Period = '7' | '14' | 'custom'

const keyExercises = [
  { label: 'Bench Press', short: 'Bench', match: (name: string) => name === 'Bench Press' },
  { label: 'Incline Dumbbell Press', short: 'Incline DB', match: (name: string) => name === 'Incline Dumbbell Press' },
  { label: 'Pull-Up', short: 'Pull-Up', match: (name: string) => name.startsWith('Pull-Up') },
  { label: 'Chest-Supported Row', short: 'Chest-Supported Row', match: (name: string) => name === 'Chest-Supported Row' },
  { label: 'Hack Squat', short: 'Hack Squat', match: (name: string) => name.startsWith('Hack Squat') },
  { label: 'Romanian Deadlift', short: 'RDL', match: (name: string) => name === 'Romanian Deadlift' },
  { label: 'Lateral Raise', short: 'Lateral Raise', match: (name: string) => name.startsWith('Lateral Raise') },
]

const topSet = (exercise: WorkoutExercise): WorkoutSet | undefined => exercise.sets
  .filter((set) => set.weight !== undefined && set.reps !== undefined)
  .sort((a, b) => ((b.weight ?? 0) * (b.reps ?? 0)) - ((a.weight ?? 0) * (a.reps ?? 0)))[0]

const setLabel = (set?: WorkoutSet) => set ? `${Number(set.weight?.toFixed(2))}×${set.reps ?? '—'}` : '—'

const setChange = (current?: WorkoutSet, previous?: WorkoutSet) => {
  if (!current || !previous) return { label: '—', positive: false }
  const weightDelta = (current.weight ?? 0) - (previous.weight ?? 0)
  if (weightDelta > 0) return { label: `+${Number(weightDelta.toFixed(2))} kg`, positive: true }
  if (weightDelta < 0) return { label: `${Number(weightDelta.toFixed(2))} kg`, positive: false }
  const repsDelta = (current.reps ?? 0) - (previous.reps ?? 0)
  if (repsDelta > 0) return { label: `+${repsDelta} rep`, positive: true }
  return { label: repsDelta === 0 ? 'bez zmiany' : `${repsDelta} rep`, positive: false }
}

const reportRangeLabel = (from: string, to: string) => {
  const start = parseDate(from)
  const end = parseDate(to)
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    const monthYear = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(end)
    return `${start.getDate()}–${end.getDate()} ${monthYear}`
  }
  return `${formatLongDate(from)} — ${formatLongDate(to)}`
}

export function CoachReport() {
  const { data, updateCoachNote } = useApp()
  const { showToast } = useToast()
  const reportRef = useRef<HTMLElement>(null)
  const today = isoToday()
  const [period, setPeriod] = useState<Period>('7')
  const [customFrom, setCustomFrom] = useState(windowFor(today, 7).from)
  const [customTo, setCustomTo] = useState(today)
  const [copied, setCopied] = useState(false)
  const [screenshotMode, setScreenshotMode] = useState(false)
  const [exporting, setExporting] = useState(false)

  const range = period === 'custom' ? { from: customFrom, to: customTo } : windowFor(today, Number(period))
  const rangeKey = `${range.from}_${range.to}`
  const [coachNote, setCoachNote] = useState(data.coachNotes[rangeKey] ?? '')

  useEffect(() => setCoachNote(data.coachNotes[rangeKey] ?? ''), [rangeKey])
  useEffect(() => {
    document.body.classList.toggle('report-screenshot-mode', screenshotMode)
    return () => document.body.classList.remove('report-screenshot-mode')
  }, [screenshotMode])

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

  const weightData = useMemo(() => weightChartData(data.dailyEntries, range.from, range.to), [data.dailyEntries, range.from, range.to])
  const waistData = useMemo(() => periodEntries.filter((entry) => typeof entry.waist === 'number').map((entry) => ({ date: entry.date, label: entry.date.slice(5).replace('-', '.'), waist: entry.waist })), [periodEntries])

  const exerciseRows = keyExercises.map((keyExercise) => {
    const occurrences = [...data.workouts]
      .filter((workout) => workout.date <= range.to)
      .sort((a, b) => b.date.localeCompare(a.date))
      .flatMap((workout) => workout.exercises.filter((exercise) => keyExercise.match(exercise.name) && !exercise.skipped && exercise.sets.length).map((exercise) => ({ workout, exercise })))
    const current = occurrences[0]
    const previous = occurrences[1]
    return { ...keyExercise, current, previous, currentSet: current ? topSet(current.exercise) : undefined, previousSet: previous ? topSet(previous.exercise) : undefined }
  })

  const thresholds = data.settings.trendThresholds
  const weeklyStatus = weightDelta === undefined ? 'Za mało danych' : weightDelta < thresholds.lossBelow ? 'Masa spada' : weightDelta <= thresholds.stableUpper ? 'Masa stabilna' : weightDelta <= thresholds.slowGainUpper ? 'Powolny wzrost masy' : 'Szybki wzrost masy'

  const progressText = exerciseRows
    .filter((row) => row.currentSet || row.previousSet)
    .map((row) => `${row.short}:\n${setLabel(row.previousSet)} → ${setLabel(row.currentSet)}`)
    .join('\n\n') || 'Brak zapisanych wyników.'

  const reportText = `FORMLOG — WEEKLY CHECK-IN
${formatShortDate(range.from)}–${formatShortDate(range.to)}

Faza: ${data.settings.phase}
Cel kcal: ${data.settings.calorieTarget}

Średnia masa: ${formatNumber(currentWeight)} kg
Zmiana 7/7: ${signed(weightDelta, ' kg')}
Talia: ${formatNumber(latestWaist?.waist)} cm
Zmiana talii: ${signed(waistDelta, ' cm')}

Średnie kcal: ${formatInteger(calories)}
Średnie białko: ${formatInteger(protein)} g
Średnie kroki: ${formatInteger(steps)}

Treningi: ${periodWorkouts.length}
Regeneracja: ${formatNumber(recovery)}/10
Status: ${weeklyStatus}

NAJWAŻNIEJSZY PROGRES

${progressText}

Coach notes:
${coachNote.trim() || '—'}`

  const copyReport = async () => {
    await navigator.clipboard.writeText(reportText)
    setCopied(true)
    showToast('Raport skopiowany')
    window.setTimeout(() => setCopied(false), 2200)
  }

  const exportPng = async () => {
    if (!reportRef.current) return
    setExporting(true)
    try {
      const image = await toPng(reportRef.current, { backgroundColor: '#111315', cacheBust: true, pixelRatio: 2 })
      if (await savePngDataUrl(image, `formlog-report-${range.from}-${range.to}.png`)) showToast('Raport PNG zapisany')
    } catch {
      showToast('Nie udało się utworzyć PNG', 'info')
    } finally {
      setExporting(false)
    }
  }

  const saveCoachNote = () => {
    updateCoachNote(rangeKey, coachNote.trim())
    showToast('Coach Notes zapisane')
  }

  return (
    <div className={`page coach-page coach-v2 ${screenshotMode ? 'coach-page--screenshot' : ''}`}>
      <PageHeader eyebrow="DLA TRENERA" title="Coach Report" description="Kompaktowy weekly check-in gotowy do wysłania trenerowi." actions={<div className="header-action-row"><button className="button button--ghost" onClick={exportPng} disabled={exporting}>{exporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} Eksportuj PNG</button><button className="button button--secondary" onClick={() => setScreenshotMode(true)}><Expand size={16} /> Tryb zrzutu</button></div>} />

      {screenshotMode && <button className="screenshot-exit" onClick={() => setScreenshotMode(false)}><X size={16} /> Wyjdź z trybu zrzutu</button>}

      <div className="report-controls"><div className="segmented-control segmented-control--large"><button className={period === '7' ? 'active' : ''} onClick={() => setPeriod('7')}>7 dni</button><button className={period === '14' ? 'active' : ''} onClick={() => setPeriod('14')}>14 dni</button><button className={period === 'custom' ? 'active' : ''} onClick={() => setPeriod('custom')}>Własny zakres</button></div>{period === 'custom' && <div className="custom-range"><label>Od <input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>Do <input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}</div>

      <section className="report-sheet report-sheet-v2" ref={reportRef}>
        <header className="report-sheet__header">
          <div><span className="section-kicker">FORMLOG WEEKLY REPORT</span><h2>{reportRangeLabel(range.from, range.to)}</h2></div>
          <div className="report-phase"><span>AKTUALNA FAZA</span><strong>{data.settings.phase.toUpperCase()}</strong><small>{data.settings.calorieTarget.toLocaleString('pl-PL')} kcal</small></div>
        </header>

        <div className="weekly-status"><Activity size={16} /><span>Weekly status</span><strong>{weeklyStatus}</strong><small>Zmiana średniej 7/7: {signed(weightDelta, ' kg')}</small></div>

        <div className="report-stats report-stats-v2">
          <ReportStat icon={Scale} label="Masa" value={`${formatNumber(currentWeight)} kg`} sub={`${signed(weightDelta, ' kg')} / tydz.`} />
          <ReportStat icon={Ruler} label="Talia" value={`${formatNumber(latestWaist?.waist)} cm`} sub={signed(waistDelta, ' cm')} />
          <ReportStat icon={Utensils} label="Kalorie" value={formatInteger(calories)} sub={`cel ${data.settings.calorieTarget}`} />
          <ReportStat icon={Utensils} label="Białko" value={`${formatInteger(protein)} g`} sub={`cel ${data.settings.proteinTarget} g`} />
          <ReportStat icon={Footprints} label="Kroki" value={formatInteger(steps)} sub="średnio / dzień" />
          <ReportStat icon={Dumbbell} label="Treningi" value={String(periodWorkouts.length)} sub="wykonane sesje" />
          <ReportStat icon={Check} label="Regeneracja" value={`${formatNumber(recovery)} / 10`} sub="średnia z wpisów" />
        </div>

        <section className="adherence-strip">
          <div className="mini-heading"><div><span className="section-kicker">REALIZACJA PLANU</span><h3>Adherence</h3></div></div>
          <div><AdherenceItem label="Kalorie" actual={formatInteger(calories)} target={String(data.settings.calorieTarget)} delta={calories === undefined ? '—' : `${calories - data.settings.calorieTarget >= 0 ? '+' : ''}${Math.round(calories - data.settings.calorieTarget)} kcal`} /><AdherenceItem label="Białko" actual={`${formatInteger(protein)} g`} target={`${data.settings.proteinTarget} g`} delta={protein === undefined ? '—' : `${protein - data.settings.proteinTarget >= 0 ? '+' : ''}${Math.round(protein - data.settings.proteinTarget)} g`} /><AdherenceItem label="Treningi" actual={String(periodWorkouts.length)} target="wykonane" delta="" /></div>
        </section>

        <div className="report-charts">
          <article><div className="mini-heading"><div><span className="section-kicker">TREND</span><h3>Masa ciała</h3></div><div className="chart-legend"><span><i className="legend-weight" /> Dzienna</span><span><i className="legend-average" /> Śr. 7 dni</span></div></div><div className="report-chart report-chart--weight">{weightData.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={weightData} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,.05)" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5).replace('-', '.')} stroke="#6f767d" tickLine={false} axisLine={false} minTickGap={24} /><YAxis domain={[(min: number) => Math.floor((min - 0.75) * 2) / 2, (max: number) => Math.ceil((max + 0.75) * 2) / 2]} stroke="#6f767d" tickLine={false} axisLine={false} width={46} /><Tooltip content={<WeightTooltip />} /><Line type="monotone" dataKey="weight" stroke="#737a80" strokeWidth={1.15} dot={{ r: 2.2, fill: '#8b9298', strokeWidth: 0 }} /><Line type="monotone" dataKey="movingAverage" stroke="#2997ff" strokeWidth={2.6} dot={false} /></LineChart></ResponsiveContainer> : <p className="report-chart__empty">Jeszcze brak pomiarów masy.</p>}</div></article>
          <article><div className="mini-heading"><div><span className="section-kicker">POMIARY</span><h3>Talia</h3></div><strong>{formatNumber(latestWaist?.waist)} cm</strong></div><div className="report-chart report-chart--waist">{waistData.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={waistData} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}><defs><linearGradient id="reportWaistAreaV2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2997ff" stopOpacity={0.15} /><stop offset="100%" stopColor="#2997ff" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,.05)" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" stroke="#6f767d" tickLine={false} axisLine={false} /><YAxis domain={['dataMin - 1', 'dataMax + 1']} stroke="#6f767d" tickLine={false} axisLine={false} width={42} /><Tooltip contentStyle={{ background: '#171a1e', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12 }} formatter={(value) => [`${formatNumber(Number(value ?? 0))} cm`, 'Talia']} /><Area type="monotone" dataKey="waist" stroke="#2997ff" strokeWidth={2.1} fill="url(#reportWaistAreaV2)" dot={{ r: 2.4, fill: '#2997ff', strokeWidth: 0 }} /></AreaChart></ResponsiveContainer> : <p className="report-chart__empty">Jeszcze brak pomiarów talii.</p>}</div></article>
        </div>

        <div className="report-lower"><article className="report-workouts"><div className="mini-heading"><div><span className="section-kicker">WYKONANE SESJE</span><h3>Treningi</h3></div><strong>{periodWorkouts.length}</strong></div>{periodWorkouts.length ? <div className="report-workout-list">{periodWorkouts.map((workout) => <div key={workout.id}><span className="template-code template-code--small">{workout.templateCode}</span><strong>{formatShortDate(workout.date)}</strong><p>{workout.templateName}</p><small>{workout.duration ? `${workout.duration} min` : 'czas —'}</small></div>)}</div> : <p className="report-list-empty">Brak treningów w wybranym okresie.</p>}</article><article className="report-exercises"><div className="mini-heading"><div><span className="section-kicker">PROGRES TRENINGOWY</span><h3>Najważniejsze ćwiczenia</h3></div></div><div className="table-scroll"><table className="data-table report-exercise-table"><thead><tr><th>Ćwiczenie</th><th>Poprzednio</th><th>Teraz</th><th>Zmiana</th></tr></thead><tbody>{exerciseRows.map((row) => { const change = setChange(row.currentSet, row.previousSet); return <tr key={row.label}><td><strong>{row.label}</strong></td><td>{setLabel(row.previousSet)}{row.previous && <small>{formatShortDate(row.previous.workout.date)}</small>}</td><td>{setLabel(row.currentSet)}{row.current && <small>{formatShortDate(row.current.workout.date)}</small>}</td><td><span className={change.positive ? 'change-pill' : 'neutral-change'}>{change.label}</span></td></tr> })}</tbody></table></div></article></div>

        <section className="coach-notes"><div><span className="section-kicker">DECYZJE I KOLEJNY KROK</span><h3>Coach Notes</h3><p>Notatka jest przypisana do zakresu {formatShortDate(range.from)}–{formatShortDate(range.to)}.</p></div><textarea rows={4} placeholder="Utrzymujemy 2800 kcal. Cel na kolejny Push…" value={coachNote} onChange={(event) => setCoachNote(event.target.value)} onBlur={saveCoachNote} /></section>

        <article className="report-copy report-copy-v2"><div><span className="section-kicker">TEKST CHECK-INU</span><p>Gotowy format do wiadomości.</p></div><button className={`button ${copied ? 'button--success' : 'button--primary'}`} onClick={copyReport}>{copied ? <Check size={17} /> : <Clipboard size={17} />} {copied ? 'Skopiowano' : 'Kopiuj raport'}</button></article>
      </section>
    </div>
  )
}

function ReportStat({ icon: Icon, label, value, sub }: { icon: typeof Scale; label: string; value: string; sub: string }) {
  return <div className="report-stat"><div><Icon size={15} /><span>{label}</span></div><strong>{value}</strong><small>{sub}</small></div>
}

function AdherenceItem({ label, actual, target, delta }: { label: string; actual: string; target: string; delta: string }) {
  return <div className="adherence-item"><span>{label}</span><strong>{actual} <small>/ {target}</small></strong>{delta && <em>{delta}</em>}</div>
}
