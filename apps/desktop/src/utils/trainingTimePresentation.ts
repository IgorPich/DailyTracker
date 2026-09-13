import type { Workout } from '@greekgod/core'

export type TrainingTimePreset = 'month' | 'year' | 'all' | 'custom'

export const trainingTimeRange = (
  preset: TrainingTimePreset,
  today: string,
  workouts: readonly Pick<Workout, 'date'>[],
  custom: { from: string; to: string },
): { from: string; to: string } => {
  if (preset === 'custom') return custom
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (preset === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today }
  const dates = workouts.map((workout) => workout.date).filter((date) => date <= today
    && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date).sort()
  return { from: dates[0] ?? today, to: today }
}

/** Presentation only: nearest whole minute, no 24-hour wrapping. */
export const formatTrainingMinutes = (minutes: number | undefined): string => {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return '—'
  if (minutes > 0 && minutes < 0.5) return '< 1 min'
  const rounded = Math.round(minutes)
  const hours = Math.floor(rounded / 60)
  return hours ? `${hours} h ${rounded % 60} min` : `${rounded} min`
}
