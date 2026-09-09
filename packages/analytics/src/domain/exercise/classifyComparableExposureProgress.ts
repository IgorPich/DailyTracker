import { classifySetPerformance } from '@greekgod/core'
import type {
  ExerciseExposure,
  ExerciseExposureWorkingSet,
} from './exerciseExposure.ts'
import type {
  ExerciseProgressReasonCode,
  ExerciseProgressSetComparison,
  ExerciseProgressStatus,
} from './exerciseProgress.ts'

interface CompleteWorkingSet extends ExerciseExposureWorkingSet {
  weight: number
  reps: number
}

export interface ComparableExposureProgress {
  status: ExerciseProgressStatus
  reasonCodes: ExerciseProgressReasonCode[]
  currentCompleteSetIds: string[]
  comparisonCompleteSetIds: string[]
  unpairedCurrentSetIds: string[]
  unpairedComparisonSetIds: string[]
  setComparisons: ExerciseProgressSetComparison[]
}

const completeWorkingSets = (exposure: ExerciseExposure): CompleteWorkingSet[] => exposure.workingSets.filter(
  (set): set is CompleteWorkingSet => Number.isFinite(set.weight) && Number.isFinite(set.reps),
)

const uniqueReasonCodes = (codes: ExerciseProgressReasonCode[]) => [...new Set(codes)]

export const classifyComparableExposureProgress = (
  current: ExerciseExposure,
  comparison: ExerciseExposure,
): ComparableExposureProgress => {
  const currentSets = completeWorkingSets(current)
  const comparisonSets = completeWorkingSets(comparison)
  const pairedCount = Math.min(currentSets.length, comparisonSets.length)
  const prescription = current.prescriptionSnapshot ?? comparison.prescriptionSnapshot
  const setComparisons = Array.from({ length: pairedCount }, (_, pairOrder): ExerciseProgressSetComparison => {
    const currentSet = currentSets[pairOrder]
    const previousSet = comparisonSets[pairOrder]
    const result = classifySetPerformance(
      { id: currentSet.setId, weight: currentSet.weight, reps: currentSet.reps, rir: currentSet.rir },
      { id: previousSet.setId, weight: previousSet.weight, reps: previousSet.reps, rir: previousSet.rir },
      prescription,
    )
    return {
      pairOrder,
      currentSetId: currentSet.setId,
      previousSetId: previousSet.setId,
      outcome: result.outcome,
      reason: result.reason,
      ...(result.weightDelta === undefined ? {} : { weightDelta: result.weightDelta }),
      ...(result.repsDelta === undefined ? {} : { repsDelta: result.repsDelta }),
      ...(result.sensibleRepFloor === undefined ? {} : { sensibleRepFloor: result.sensibleRepFloor }),
    }
  })
  const unpairedCurrentSetIds = currentSets.slice(pairedCount).map((set) => set.setId)
  const unpairedComparisonSetIds = comparisonSets.slice(pairedCount).map((set) => set.setId)
  const setCountChanged = currentSets.length !== comparisonSets.length

  if (!setComparisons.length) {
    return {
      status: 'INSUFFICIENT_DATA',
      reasonCodes: ['NO_COMPARABLE_COMPLETE_SET_PAIR'],
      currentCompleteSetIds: currentSets.map((set) => set.setId),
      comparisonCompleteSetIds: comparisonSets.map((set) => set.setId),
      unpairedCurrentSetIds,
      unpairedComparisonSetIds,
      setComparisons,
    }
  }

  const outcomes = setComparisons.map((item) => item.outcome)
  const hasBetter = outcomes.includes('BETTER')
  const hasWorse = outcomes.includes('WORSE')
  const hasTradeOff = outcomes.includes('TRADE_OFF') || outcomes.includes('WARNING')
  const directionalResultIsConsistent = !setCountChanged && !hasTradeOff && !(hasBetter && hasWorse)
  let status: ExerciseProgressStatus = 'FLAT'
  if (directionalResultIsConsistent && hasBetter) status = 'PROGRESS'
  if (directionalResultIsConsistent && hasWorse) status = 'REGRESSION'

  const reasonCodes: ExerciseProgressReasonCode[] = setComparisons.map((item) => item.reason)
  if (setCountChanged) reasonCodes.push('SET_COUNT_CHANGED')
  if (hasTradeOff) reasonCodes.push('PERFORMANCE_TRADE_OFF')
  if (setCountChanged || (hasBetter && hasWorse)) reasonCodes.push('MIXED_SET_PERFORMANCE')

  return {
    status,
    reasonCodes: uniqueReasonCodes(reasonCodes),
    currentCompleteSetIds: currentSets.map((set) => set.setId),
    comparisonCompleteSetIds: comparisonSets.map((set) => set.setId),
    unpairedCurrentSetIds,
    unpairedComparisonSetIds,
    setComparisons,
  }
}
