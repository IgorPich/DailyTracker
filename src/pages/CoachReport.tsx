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
import { average, entriesBetween, formatInteger, formatNumber, latestMeasurement, signed, waistChange, weightChartData, windowFor, workoutsBetween } from '../utils/calculations'
import { formatLongDate, formatShortDate, isoToday, parseDate } from '../utils/date'
import { phaseLabel } from '../utils/labels'
import { compareExercises, formatGymName, formatSet, getBestSet } from '../utils/workoutProgress'

type Period = '7' | '14' | 'custom'

const keyExercises = [
  { label: 'Wyciskanie sztangi na ławce', short: 'Wyciskanie sztangi', ids: ['bench-press'] },
  { label: 'Wyciskanie hantli na skosie', short: 'Wyciskanie hantli', ids: ['incline-dumbbell-press'] },
  { label: 'Podciąganie', short: 'Podciąganie', ids: ['pull-up'] },
  { label: 'Wiosło na wyciągu', short: 'Wiosło na wyciągu', ids: ['chest-supported-row', 'machine-row'] },
  { label: 'Przysiad na hack-maszynie', short: 'Hack-maszyna', ids: ['hack-squat'] },
  { label: 'Martwy ciąg rumuński', short: 'Martwy ciąg rumuński', ids: ['romanian-deadlift'] },
  { label: 'Unoszenie ramion bokiem', short: 'Unoszenie bokiem', ids: ['lateral-raise-machine', 'lateral-raise-cable'] },
]

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
  const gymCounts = [...periodWorkouts.reduce((counts, workout) => {
    const gym = workout.gymLocation?.trim() || 'Nie podano'
    counts.set(gym, (counts.get(gym) ?? 0) + 1)
    return counts
  }, new Map<string, number>())]
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
  const carbs = average(periodEntries.map((entry) => entry.carbs))
  const steps = average(periodEntries.map((entry) => entry.steps))
  const weightData = useMemo(() => weightChartData(data.dailyEntries, range.from, range.to), [data.dailyEntries, range.from, range.to])
  const waistData = useMemo(() => periodEntries.filter((entry) => typeof entry.waist === 'number').map((entry) => ({ date: entry.date, label: entry.date.slice(5).replace('-', '.'), waist: entry.waist })), [periodEntries])

  const exerciseRows = keyExercises.map((keyExercise) => {
    const occurrences = [...data.workouts]
      .filter((workout) => workout.date <= range.to)
      .sort((a, b) => b.date.localeCompare(a.date))
      .flatMap((workout) => workout.exercises.filter((exercise) => keyExercise.ids.includes(exercise.id) && !exercise.skipped && exercise.sets.length).map((exercise) => ({ workout, exercise })))
    const current = occurrences[0]
    const previous = occurrences[1]
    return {
      ...keyExercise,
      current,
      previous,
      currentSet: current ? getBestSet(current.exercise) : undefined,
      previousSet: previous ? getBestSet(previous.exercise) : undefined,
      change: compareExercises(current?.exercise, previous?.exercise, current?.workout.gymLocation, previous?.workout.gymLocation),
    }
  })

  const thresholds = data.settings.trendThresholds
  const weeklyStatus = weightDelta === undefined ? 'Za mało danych' : weightDelta < thresholds.lossBelow ? 'Masa spada' : weightDelta <= thresholds.stableUpper ? 'Masa stabilna' : weightDelta <= thresholds.slowGainUpper ? 'Powolny wzrost masy' : 'Szybki wzrost masy'

  const progressText = exerciseRows
    .filter((row) => row.currentSet || row.previousSet)
    .map((row) => `${row.short}:\nPoprzednio: ${row.previous ? `${formatGymName(row.previous.workout.gymLocation)} — ` : ''}${formatSet(row.previousSet)}\nTeraz: ${row.current ? `${formatGymName(row.current.workout.gymLocation)} — ` : ''}${formatSet(row.currentSet)}\n${row.change.label}`)
    .join('\n\n') || 'Brak zapisanych wyników.'

  const gymsText = !gymCounts.length
    ? 'Siłownie: —'
    : gymCounts.length === 1
      ? `Siłownia: ${gymCounts[0][0]}`
      : gymCounts.map(([gym, count]) => `${gym}: ${count}`).join('\n')

  const reportText = `GREEKGOD — TYGODNIOWE PODSUMOWANIE
${formatShortDate(range.from)}–${formatShortDate(range.to)}

Faza: ${phaseLabel(data.settings.phase)}
Cel kcal: ${data.settings.calorieTarget}

Średnia masa: ${formatNumber(currentWeight)} kg
Zmiana 7/7: ${signed(weightDelta, ' kg')}
Talia: ${formatNumber(latestWaist?.waist)} cm
Zmiana talii: ${signed(waistDelta, ' cm')}

Średnie kcal: ${formatInteger(calories)}
Średnie białko: ${formatInteger(protein)} g
Średnie węglowodany: ${formatInteger(carbs)} g
Średnie kroki: ${formatInteger(steps)}

Treningi: ${periodWorkouts.length}
${gymsText}
Status: ${weeklyStatus}

NAJWAŻNIEJSZY PROGRES

${progressText}

Notatki trenera:
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
      if (await savePngDataUrl(image, `greekgod-report-${range.from}-${range.to}.png`)) showToast('Raport PNG zapisany')
    } catch {
      showToast('Nie udało się utworzyć PNG', 'info')
    } finally {
      setExporting(false)
    }
  }

  const saveCoachNote = () => {
    updateCoachNote(rangeKey, coachNote.trim())
    showToast('Notatki trenera zapisane')
  }

  return (
    <div className={`page coach-page coach-v2 ${screenshotMode ? 'coach-page--screenshot' : ''}`}>
      <PageHeader eyebrow="DLA TRENERA" title="Raport dla trenera" description="Kompaktowe tygodniowe podsumowanie gotowe do wysłania trenerowi." actions={<div className="header-action-row"><button className="button button--ghost" onClick={exportPng} disabled={exporting}>{exporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} Eksportuj PNG</button><button className="button button--secondary" onClick={() => setScreenshotMode(true)}><Expand size={16} /> Tryb zrzutu</button></div>} />

      {screenshotMode && <button className="screenshot-exit" onClick={() => setScreenshotMode(false)}><X size={16} /> Wyjdź z trybu zrzutu</button>}

      <div className="report-controls"><div className="segmented-control segmented-control--large"><button className={period === '7' ? 'active' : ''} onClick={() => setPeriod('7')}>7 dni</button><button className={period === '14' ? 'active' : ''} onClick={() => setPeriod('14')}>14 dni</button><button className={period === 'custom' ? 'active' : ''} onClick={() => setPeriod('custom')}>Własny zakres</button></div>{period === 'custom' && <div className="custom-range"><label>Od <input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>Do <input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}</div>

      <section className="report-sheet report-sheet-v2" ref={reportRef}>
        <header className="report-sheet__header">
          <div><span className="section-kicker">GREEKGOD — RAPORT TYGODNIOWY</span><h2>{reportRangeLabel(range.from, range.to)}</h2></div>
          <div className="report-phase"><span>AKTUALNA FAZA</span><strong>{phaseLabel(data.settings.phase).toUpperCase()}</strong><small>{formatInteger(data.settings.calorieTarget)} kcal</small></div>
        </header>

        <div className="weekly-status"><Activity size={16} /><span>Status tygodniowy</span><strong>{weeklyStatus}</strong><small>Zmiana średniej 7/7: {signed(weightDelta, ' kg')}</small></div>

        <div className="report-stats report-stats-v2">
          <ReportStat icon={Scale} label="Masa" value={`${formatNumber(currentWeight)} kg`} sub={`${signed(weightDelta, ' kg')} / tydz.`} />
          <ReportStat icon={Ruler} label="Talia" value={`${formatNumber(latestWaist?.waist)} cm`} sub={signed(waistDelta, ' cm')} />
          <ReportStat icon={Utensils} label="Kalorie" value={formatInteger(calories)} sub={`cel ${data.settings.calorieTarget}`} />
          <ReportStat icon={Utensils} label="Białko" value={`${formatInteger(protein)} g`} sub={`cel ${data.settings.proteinTarget} g`} />
          <ReportStat icon={Utensils} label="Węglowodany" value={`${formatInteger(carbs)} g`} sub="średnio / dzień" />
          <ReportStat icon={Footprints} label="Kroki" value={formatInteger(steps)} sub="średnio / dzień" />
          <ReportStat icon={Dumbbell} label="Treningi" value={String(periodWorkouts.length)} sub="wykonane sesje" />
        </div>

        <section className="adherence-strip">
          <div className="mini-heading"><div><span className="section-kicker">REALIZACJA PLANU</span><h3>Realizacja celów</h3></div></div>
          <div><AdherenceItem label="Kalorie" actual={formatInteger(calories)} target={String(data.settings.calorieTarget)} delta={calories === undefined ? '—' : `${calories - data.settings.calorieTarget >= 0 ? '+' : ''}${Math.round(calories - data.settings.calorieTarget)} kcal`} /><AdherenceItem label="Białko" actual={`${formatInteger(protein)} g`} target={`${data.settings.proteinTarget} g`} delta={protein === undefined ? '—' : `${protein - data.settings.proteinTarget >= 0 ? '+' : ''}${Math.round(protein - data.settings.proteinTarget)} g`} /><AdherenceItem label="Treningi" actual={String(periodWorkouts.length)} target="wykonane" delta="" /></div>
        </section>

        <div className="report-charts">
          <article><div className="mini-heading"><div><span className="section-kicker">TREND</span><h3>Masa ciała</h3></div><div className="chart-legend"><span><i className="legend-weight" /> Dzienna</span><span><i className="legend-average" /> Śr. 7 dni</span></div></div><div className="report-chart report-chart--weight">{weightData.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={weightData} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,.05)" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5).replace('-', '.')} stroke="#6f767d" tickLine={false} axisLine={false} minTickGap={24} /><YAxis domain={[(min: number) => Math.floor((min - 0.75) * 2) / 2, (max: number) => Math.ceil((max + 0.75) * 2) / 2]} stroke="#6f767d" tickLine={false} axisLine={false} width={46} /><Tooltip content={<WeightTooltip />} /><Line type="monotone" dataKey="weight" stroke="#737a80" strokeWidth={1.15} dot={{ r: 2.2, fill: '#8b9298', strokeWidth: 0 }} /><Line type="monotone" dataKey="movingAverage" stroke="#2997ff" strokeWidth={2.6} dot={false} /></LineChart></ResponsiveContainer> : <p className="report-chart__empty">Jeszcze brak pomiarów masy.</p>}</div></article>
          <article><div className="mini-heading"><div><span className="section-kicker">POMIARY</span><h3>Talia</h3></div><strong>{formatNumber(latestWaist?.waist)} cm</strong></div><div className="report-chart report-chart--waist">{waistData.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={waistData} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}><defs><linearGradient id="reportWaistAreaV2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2997ff" stopOpacity={0.15} /><stop offset="100%" stopColor="#2997ff" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,.05)" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" stroke="#6f767d" tickLine={false} axisLine={false} /><YAxis domain={['dataMin - 1', 'dataMax + 1']} stroke="#6f767d" tickLine={false} axisLine={false} width={42} /><Tooltip contentStyle={{ background: '#171a1e', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12 }} formatter={(value) => [`${formatNumber(Number(value ?? 0))} cm`, 'Talia']} /><Area type="monotone" dataKey="waist" stroke="#2997ff" strokeWidth={2.1} fill="url(#reportWaistAreaV2)" dot={{ r: 2.4, fill: '#2997ff', strokeWidth: 0 }} /></AreaChart></ResponsiveContainer> : <p className="report-chart__empty">Jeszcze brak pomiarów talii.</p>}</div></article>
        </div>

        <div className="report-lower"><article className="report-workouts"><div className="mini-heading"><div><span className="section-kicker">WYKONANE SESJE</span><h3>Treningi</h3></div><strong>{periodWorkouts.length}</strong></div><div className="report-gym-summary">{!gymCounts.length ? <span>Siłownie: —</span> : gymCounts.length === 1 ? <span>Siłownia: <strong>{gymCounts[0][0]}</strong></span> : gymCounts.map(([gym, count]) => <span key={gym}>{gym}: <strong>{count}</strong></span>)}</div>{periodWorkouts.length ? <div className="report-workout-list">{periodWorkouts.map((workout) => <div key={workout.id}><span className="template-code template-code--small">{workout.templateCode}</span><strong>{formatShortDate(workout.date)}</strong><p>{workout.templateName}</p><small>{formatGymName(workout.gymLocation)} · {workout.duration ? `${workout.duration} min` : 'czas —'}</small></div>)}</div> : <p className="report-list-empty">Brak treningów w wybranym okresie.</p>}</article><article className="report-exercises"><div className="mini-heading"><div><span className="section-kicker">PROGRES TRENINGOWY</span><h3>Najważniejsze ćwiczenia</h3></div></div><div className="table-scroll"><table className="data-table report-exercise-table"><thead><tr><th>Ćwiczenie</th><th>Poprzednio</th><th>Teraz</th><th>Zmiana</th></tr></thead><tbody>{exerciseRows.map((row) => <tr key={row.label}><td><strong>{row.label}</strong></td><td>{formatSet(row.previousSet)}{row.previous && <small>{formatShortDate(row.previous.workout.date)} · {formatGymName(row.previous.workout.gymLocation)}</small>}</td><td>{formatSet(row.currentSet)}{row.current && <small>{formatShortDate(row.current.workout.date)} · {formatGymName(row.current.workout.gymLocation)}</small>}</td><td><span className={row.change.positive ? 'change-pill' : 'neutral-change'}>{row.change.label}</span></td></tr>)}</tbody></table></div></article></div>

        <section className="coach-notes"><div><span className="section-kicker">DECYZJE I KOLEJNY KROK</span><h3>Notatki trenera</h3><p>Notatka jest przypisana do zakresu {formatShortDate(range.from)}–{formatShortDate(range.to)}.</p></div><textarea rows={4} placeholder="Utrzymujemy 2800 kcal. Cel na kolejny trening PUSH…" value={coachNote} onChange={(event) => setCoachNote(event.target.value)} onBlur={saveCoachNote} /></section>

        <article className="report-copy report-copy-v2"><div><span className="section-kicker">TEKST PODSUMOWANIA</span><p>Gotowy format do wiadomości.</p></div><button className={`button ${copied ? 'button--success' : 'button--primary'}`} onClick={copyReport}>{copied ? <Check size={17} /> : <Clipboard size={17} />} {copied ? 'Skopiowano' : 'Kopiuj raport'}</button></article>
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
