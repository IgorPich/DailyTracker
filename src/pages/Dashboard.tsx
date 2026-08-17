import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Dumbbell,
  Footprints,
  Gauge,
  NotebookPen,
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
import { MetricCard } from '../components/MetricCard'
import { PageHeader } from '../components/PageHeader'
import { WeightTooltip } from '../components/ChartTooltip'
import { useApp } from '../context/AppContext'
import type { Phase } from '../types'
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

export function Dashboard({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { data, updateSettings } = useApp()
  const [range, setRange] = useState<Range>('30')
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
  const latestWaist = latestMeasurement(data.dailyEntries, 'waist')
  const recentWorkouts = data.workouts.filter((workout) => workout.date >= currentWindow.from && workout.date <= currentWindow.to)

  const chartFrom = range === 'all' ? undefined : daysAgoIso(Number(range) - 1)
  const chartData = useMemo(
    () => weightChartData(data.dailyEntries, chartFrom, today),
    [data.dailyEntries, chartFrom, today],
  )
  const waistData = useMemo(
    () => [...data.dailyEntries]
      .filter((entry) => typeof entry.waist === 'number' && (!chartFrom || entry.date >= chartFrom))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((entry) => ({ date: entry.date, label: entry.date.slice(5).replace('-', '.'), waist: entry.waist })),
    [data.dailyEntries, chartFrom],
  )

  const lastWorkout = [...data.workouts].sort((a, b) => b.date.localeCompare(a.date))[0]
  const templateIndex = lastWorkout ? data.templates.findIndex((template) => template.id === lastWorkout.templateId) : -1
  const nextTemplate = data.templates[(templateIndex + 1 + data.templates.length) % data.templates.length] ?? data.templates[0]

  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow={formatLongDate(today)}
        title="Twój przegląd"
        description="Najważniejsze liczby z ostatnich 7 dni."
        actions={
          <div className="header-action-row">
            <button className="button button--ghost" onClick={() => onNavigate('journal')}><NotebookPen size={17} /> Dodaj wpis</button>
            <button className="button button--primary" onClick={() => onNavigate('training')}><Dumbbell size={17} /> Rozpocznij trening</button>
          </div>
        }
      />

      <section className="status-strip card">
        <div className="status-strip__phase">
          <span className="section-kicker">AKTUALNA FAZA</span>
          <select
            className="phase-select"
            value={data.settings.phase}
            onChange={(event) => updateSettings({ phase: event.target.value as Phase })}
            aria-label="Aktualna faza"
          >
            {phases.map((phase) => <option key={phase}>{phase}</option>)}
          </select>
        </div>
        <div className="status-strip__item">
          <span>Cel kalorii</span>
          <label><input type="number" inputMode="numeric" value={data.settings.calorieTarget} onChange={(event) => updateSettings({ calorieTarget: Number(event.target.value) })} /> kcal</label>
        </div>
        <div className="status-strip__item"><span>Średnia masa</span><strong>{formatNumber(currentWeight)} <small>kg</small></strong></div>
        <div className="status-strip__item"><span>Zmiana 7/7</span><strong className={weightDelta === undefined ? '' : weightDelta > 0 ? 'value-up' : weightDelta < 0 ? 'value-down' : ''}>{signed(weightDelta, ' kg')}</strong></div>
        <div className="status-strip__item"><span>Ostatnia talia</span><strong>{formatNumber(latestWaist?.waist)} <small>cm</small></strong></div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="Średnia masa" value={formatNumber(currentWeight)} unit="kg" detail="ostatnie 7 dni" icon={Scale} />
        <MetricCard label="Zmiana masy" value={signed(weightDelta)} unit="kg" detail="vs poprzednie 7 dni" icon={Activity} tone={weightDelta && weightDelta > 0 ? 'positive' : weightDelta && weightDelta < 0 ? 'negative' : 'default'} />
        <MetricCard label="Talia" value={formatNumber(latestWaist?.waist)} unit="cm" detail={latestWaist ? formatLongDate(latestWaist.date) : 'brak pomiaru'} icon={Ruler} />
        <MetricCard label="Średnie kcal" value={formatInteger(calories)} unit="kcal" detail={`cel ${data.settings.calorieTarget.toLocaleString('pl-PL')}`} icon={Utensils} />
        <MetricCard label="Średnie białko" value={formatInteger(protein)} unit="g" detail={`cel ${data.settings.proteinTarget} g`} icon={Gauge} />
        <MetricCard label="Treningi" value={String(recentWorkouts.length)} detail="ostatnie 7 dni" icon={Dumbbell} />
        <MetricCard label="Średnie kroki" value={formatInteger(steps)} detail="ostatnie 7 dni" icon={Footprints} />
      </section>

      <section className="dashboard-grid">
        <article className="card chart-card chart-card--weight">
          <div className="card-heading">
            <div><span className="section-kicker">TREND</span><h2>Masa ciała</h2></div>
            <div className="segmented-control" aria-label="Zakres wykresu">
              {(['30', '90', 'all'] as const).map((option) => (
                <button key={option} className={range === option ? 'active' : ''} onClick={() => setRange(option)}>
                  {option === 'all' ? 'Całość' : `${option} dni`}
                </button>
              ))}
            </div>
          </div>
          {chartData.length ? (
            <div className="chart chart--large">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#252a2f" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(value) => value.slice(5).replace('-', '.')} stroke="#6f767d" tickLine={false} axisLine={false} minTickGap={30} />
                  <YAxis domain={[(min: number) => Math.floor((min - 1) * 2) / 2, (max: number) => Math.ceil((max + 1) * 2) / 2]} stroke="#6f767d" tickLine={false} axisLine={false} tickFormatter={(value) => value.toFixed(1)} />
                  <Tooltip content={<WeightTooltip />} />
                  <Line type="monotone" dataKey="weight" stroke="#778087" strokeWidth={1.4} dot={{ r: 2.2, fill: '#778087' }} activeDot={{ r: 4 }} connectNulls />
                  <Line type="monotone" dataKey="movingAverage" stroke="#b8f24a" strokeWidth={2.8} dot={false} activeDot={{ r: 4, fill: '#b8f24a' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={Scale} title="Brak danych o masie" description="Dodaj pierwszy pomiar w Dzienniku, a tutaj pojawi się trend." action={<button className="text-button" onClick={() => onNavigate('journal')}>Przejdź do dziennika <ArrowRight size={15} /></button>} />
          )}
          {chartData.length > 0 && <div className="chart-legend"><span><i className="legend-weight" /> Masa dzienna</span><span><i className="legend-average" /> Średnia 7 dni</span></div>}
        </article>

        <div className="dashboard-side">
          <article className="card rolling-card">
            <div className="card-heading"><div><span className="section-kicker">ROLLING SPLIT</span><h2>Następny trening</h2></div><CalendarDays size={19} /></div>
            <div className="workout-route">
              <div><span>Ostatni</span><strong>{lastWorkout ? `${lastWorkout.templateCode} · ${lastWorkout.templateName}` : 'Brak treningu'}</strong></div>
              <ArrowRight size={20} />
              <div><span>Sugerowany</span><strong className="accent-text">{nextTemplate.code} · {nextTemplate.name}</strong></div>
            </div>
            <button className="button button--secondary button--full" onClick={() => onNavigate('training')}>Otwórz trening <ArrowRight size={16} /></button>
          </article>

          <article className="card chart-card chart-card--waist">
            <div className="card-heading"><div><span className="section-kicker">POMIARY</span><h2>Talia</h2></div><strong>{formatNumber(latestWaist?.waist)} <small>cm</small></strong></div>
            {waistData.length ? (
              <div className="chart chart--small">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={waistData} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                    <defs><linearGradient id="waistArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b8f24a" stopOpacity={0.2} /><stop offset="100%" stopColor="#b8f24a" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid stroke="#252a2f" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" stroke="#6f767d" tickLine={false} axisLine={false} minTickGap={28} />
                    <YAxis domain={['dataMin - 1', 'dataMax + 1']} stroke="#6f767d" tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value) => [`${formatNumber(Number(value ?? 0))} cm`, 'Talia']} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ? formatLongDate(payload[0].payload.date) : ''} contentStyle={{ background: '#171a1e', border: '1px solid #30353a', borderRadius: 8 }} />
                    <Area type="monotone" dataKey="waist" stroke="#b8f24a" strokeWidth={2} fill="url(#waistArea)" dot={{ r: 2.5, fill: '#b8f24a' }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyState icon={Ruler} title="Brak pomiarów talii" description="Talia nie musi być mierzona codziennie." />}
          </article>
        </div>
      </section>
    </div>
  )
}
