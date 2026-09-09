import type { WorkoutSet } from './types.ts'

export interface RepRange {
  min: number
  max: number
}

export type SetPerformanceOutcome =
  | 'BETTER'
  | 'EQUIVALENT'
  | 'WORSE'
  | 'TRADE_OFF'
  | 'WARNING'
  | 'INCOMPLETE'

export type SetPerformanceReason =
  | 'MORE_REPS_SAME_LOAD'
  | 'SAME_LOAD_AND_REPS'
  | 'LOWER_REPS_SAME_LOAD'
  | 'LOAD_INCREASE_WITH_REPS_MAINTAINED'
  | 'LOAD_INCREASE_WITH_LOWER_REPS'
  | 'LOAD_INCREASE_BELOW_REP_FLOOR'
  | 'LOAD_DECREASE_WITH_MORE_REPS'
  | 'LOAD_DECREASE_WITHOUT_REP_IMPROVEMENT'
  | 'INCOMPLETE_SET_DATA'

export interface SetPerformanceComparison {
  outcome: SetPerformanceOutcome
  reason: SetPerformanceReason
  weightDelta?: number
  repsDelta?: number
  sensibleRepFloor?: number
}

export const prescriptionRepRange = (prescription?: string): RepRange | undefined => {
  if (!prescription) return undefined
  const ranges = [...prescription.matchAll(/(\d+)\s*[–-]\s*(\d+)/g)]
    .map((match) => ({ min: Number(match[1]), max: Number(match[2]) }))
    .filter((range) => Number.isFinite(range.min) && Number.isFinite(range.max))
  if (!ranges.length) return undefined
  return {
    min: Math.min(...ranges.map((range) => range.min)),
    max: Math.max(...ranges.map((range) => range.max)),
  }
}

export const classifySetPerformance = (
  current?: WorkoutSet,
  previous?: WorkoutSet,
  prescription?: string,
): SetPerformanceComparison => {
  if (
    !current
    || !previous
    || current.weight === undefined
    || current.reps === undefined
    || previous.weight === undefined
    || previous.reps === undefined
  ) {
    return { outcome: 'INCOMPLETE', reason: 'INCOMPLETE_SET_DATA' }
  }

  const weightDelta = Number((current.weight - previous.weight).toFixed(2))
  const repsDelta = current.reps - previous.reps
  const deltas = { weightDelta, repsDelta }

  if (weightDelta === 0) {
    if (repsDelta > 0) return { outcome: 'BETTER', reason: 'MORE_REPS_SAME_LOAD', ...deltas }
    if (repsDelta < 0) return { outcome: 'WORSE', reason: 'LOWER_REPS_SAME_LOAD', ...deltas }
    return { outcome: 'EQUIVALENT', reason: 'SAME_LOAD_AND_REPS', ...deltas }
  }

  if (weightDelta > 0) {
    const range = prescriptionRepRange(prescription)
    const sensibleRepFloor = range?.min ?? Math.max(1, previous.reps - 2)
    if (current.reps < sensibleRepFloor) {
      return {
        outcome: 'WARNING',
        reason: 'LOAD_INCREASE_BELOW_REP_FLOOR',
        ...deltas,
        sensibleRepFloor,
      }
    }
    return repsDelta >= 0
      ? { outcome: 'BETTER', reason: 'LOAD_INCREASE_WITH_REPS_MAINTAINED', ...deltas, sensibleRepFloor }
      : { outcome: 'TRADE_OFF', reason: 'LOAD_INCREASE_WITH_LOWER_REPS', ...deltas, sensibleRepFloor }
  }

  return repsDelta > 0
    ? { outcome: 'TRADE_OFF', reason: 'LOAD_DECREASE_WITH_MORE_REPS', ...deltas }
    : { outcome: 'WORSE', reason: 'LOAD_DECREASE_WITHOUT_REP_IMPROVEMENT', ...deltas }
}
