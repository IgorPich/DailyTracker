import type { Workout } from '@greekgod/core'

export interface TrainingTimeSummaryQuery {
  snapshot: { workouts: readonly Readonly<Pick<Workout, 'id' | 'date' | 'duration'>>[] }
  from: string
  to: string
  /** Explicit calendar-date horizon; the requested interval must not exceed it. */
  asOf: string
}

export interface TrainingTimeSummaryResult {
  from: string
  to: string
  asOf: string
  recordedWorkoutCount: number
  workoutsWithDuration: number
  /** Includes missing and invalid durations. */
  workoutsWithoutDuration: number
  totalDurationMinutes: number
  averageDurationMinutes?: number
  coverage: { numerator: number; denominator: number }
  /** IDs contributing to the measured total, ordered by date then ID. */
  evidenceWorkoutIds: string[]
}

const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date

/** Read-only v1: recorded records, never inferred completed sessions. Minutes are persisted values. */
export const trainingTimeSummary = ({ snapshot, from, to, asOf }: TrainingTimeSummaryQuery): TrainingTimeSummaryResult => {
  if (![from, to, asOf].every(validDate) || from > to || to > asOf) {
    throw new RangeError('Training time dates must be valid ISO calendar dates with from <= to <= asOf.')
  }
  const records = snapshot.workouts.filter((workout) => validDate(workout.date)
    && workout.date >= from && workout.date <= to)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const measured = records.filter((workout) => typeof workout.duration === 'number'
    && Number.isFinite(workout.duration) && workout.duration > 0)
  const totalDurationMinutes = measured.reduce((total, workout) => total + workout.duration!, 0)
  if (!Number.isFinite(totalDurationMinutes)) throw new RangeError('Training time total exceeds numeric capacity.')
  return {
    from, to, asOf,
    recordedWorkoutCount: records.length,
    workoutsWithDuration: measured.length,
    workoutsWithoutDuration: records.length - measured.length,
    totalDurationMinutes,
    ...(measured.length ? { averageDurationMinutes: totalDurationMinutes / measured.length } : {}),
    coverage: { numerator: measured.length, denominator: records.length },
    evidenceWorkoutIds: measured.map((workout) => workout.id),
  }
}
