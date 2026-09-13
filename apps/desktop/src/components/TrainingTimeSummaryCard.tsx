import { useMemo, useState } from 'react'
import { trainingTimeSummary } from '@greekgod/analytics'
import type { Workout } from '@greekgod/core'
import { formatTrainingMinutes, trainingTimeRange, type TrainingTimePreset } from '../utils/trainingTimePresentation'

export const TrainingTimeSummaryCard = ({ workouts, today }: { workouts: readonly Workout[]; today: string }) => {
  const [preset, setPreset] = useState<TrainingTimePreset>('month')
  const [custom, setCustom] = useState({ from: `${today.slice(0, 7)}-01`, to: today })
  const range = trainingTimeRange(preset, today, workouts, custom)
  const summary = useMemo(() => {
    try {
      return trainingTimeSummary({ snapshot: { workouts }, ...range, asOf: today })
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      return undefined
    }
  }, [workouts, range.from, range.to, today])

  return <section className="card training-time-card" aria-label="Zapisany czas treningów">
    <div className="card-heading"><h2>Zapisany czas treningów</h2>
      <label className="field"><span>Okres</span><select value={preset} onChange={(event) => setPreset(event.target.value as TrainingTimePreset)}>
        <option value="month">Ten miesiąc</option><option value="year">Ten rok</option>
        <option value="all">Całość</option><option value="custom">Własny zakres</option>
      </select></label>
    </div>
    {preset === 'custom' && <div className="training-time-dates">
      <label className="field"><span>Od</span><input type="date" max={custom.to || today} value={custom.from} onChange={(event) => setCustom((current) => ({ ...current, from: event.target.value }))} /></label>
      <label className="field"><span>Do</span><input type="date" min={custom.from} max={today} value={custom.to} onChange={(event) => setCustom((current) => ({ ...current, to: event.target.value }))} /></label>
    </div>}
    <div aria-live="polite">
      {summary ? <>
        <p>{summary.from} – {summary.to} (włącznie)</p>
        <dl className="training-time-metrics">
          <div><dt>Łączny zapisany czas</dt><dd>{summary.workoutsWithDuration ? formatTrainingMinutes(summary.totalDurationMinutes) : '—'}</dd></div>
          <div><dt>Zapisane treningi</dt><dd>{summary.recordedWorkoutCount}</dd></div>
          <div><dt>Średnio (z dostępnym czasem)</dt><dd>{formatTrainingMinutes(summary.averageDurationMinutes)}</dd></div>
        </dl>
        <p>Czas dostępny: {summary.coverage.numerator}/{summary.coverage.denominator} zapisanych treningów.</p>
        {summary.workoutsWithoutDuration > 0 && <p role="status">Niepełne dane: {summary.workoutsWithoutDuration} zapisanych treningów bez poprawnego czasu. Suma i średnia obejmują tylko dostępne czasy.</p>}
        {!summary.recordedWorkoutCount && <p>Brak zapisanych treningów w tym okresie.</p>}
        {!!summary.recordedWorkoutCount && !summary.workoutsWithDuration && <p>Brak dostępnych danych o czasie.</p>}
      </> : <p role="alert">Nie można obliczyć podsumowania. Sprawdź zakres: prawidłowe daty od ≤ do ≤ dzisiaj.</p>}
    </div>
    <small>Podsumowanie zapisanych rekordów, nie potwierdzonych ukończonych sesji. Brak czasu nie oznacza 0 minut. Wyświetlane czasy są zaokrąglone do minut.</small>
  </section>
}
