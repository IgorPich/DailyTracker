import type { WorkoutExercise, WorkoutSet } from './types'
import { classifyExerciseComparability } from './exerciseComparability.ts'
import { canonicalExerciseId } from './exerciseIdentity.ts'
import { formatDecimal } from './numbers.ts'
import { classifySetPerformance, prescriptionRepRange } from './setPerformanceComparison.ts'

export { prescriptionRepRange } from './setPerformanceComparison.ts'

export interface ProgressResult {
  label: string
  tone: 'positive' | 'negative' | 'warning' | 'neutral'
  incomparable?: boolean
}

const completeSets = (exercise: WorkoutExercise) => exercise.sets
  .map((set, index) => ({ set, index }))
  .filter(({ set }) => Number.isFinite(set.weight) && Number.isFinite(set.reps))

const BUILTIN_EQUIPMENT_SENSITIVE_IDS = new Set([
  'cable-fly',
  'lateral-raise-machine',
  'overhead-triceps-extension',
  'rope-pushdown',
  'cable-crunch',
  'chest-supported-row',
  'single-arm-lat-pulldown',
  'straight-arm-pulldown',
  'rear-delt-machine',
  'bayesian-curl',
  'hack-squat',
  'leg-curl',
  'leg-extension',
  'adductor',
  'calf-raise',
  'incline-smith',
  'lat-pulldown',
  'machine-row',
  'lateral-raise-cable',
  'reverse-fly',
  'overhead-triceps-extension-d',
  'cable-crunch-d',
])

export const isEquipmentSensitive = (exercise?: Pick<WorkoutExercise, 'id' | 'exerciseId' | 'equipmentSensitive'>) => Boolean(
  exercise && (exercise.equipmentSensitive ?? (
    BUILTIN_EQUIPMENT_SENSITIVE_IDS.has(canonicalExerciseId(exercise) ?? '')
  )),
)

const bestSetWithIndex = (exercise: WorkoutExercise) => {
  const sets = completeSets(exercise)
  if (!sets.length) return undefined
  const range = prescriptionRepRange(exercise.prescription)
  const inRange = range
    ? sets.filter(({ set }) => (set.reps ?? 0) >= range.min && (set.reps ?? 0) <= range.max)
    : []
  const candidates = inRange.length ? inRange : sets
  return [...candidates].sort((left, right) => {
    const weightDelta = (right.set.weight ?? 0) - (left.set.weight ?? 0)
    return weightDelta || (right.set.reps ?? 0) - (left.set.reps ?? 0)
  })[0]
}

export const getBestSet = (exercise: WorkoutExercise): WorkoutSet | undefined => bestSetWithIndex(exercise)?.set

export const formatSet = (set?: WorkoutSet) => {
  if (!set || set.weight === undefined || set.reps === undefined) return '—'
  return `${formatDecimal(set.weight)}×${formatDecimal(set.reps, 0)}`
}

export const formatGymName = (name?: string) => name?.trim() || 'nie podano'

export const equipmentComparisonIssue = (
  current: WorkoutExercise | undefined,
  previous: WorkoutExercise | undefined,
  currentGymLocation?: string,
  previousGymLocation?: string,
): ProgressResult | undefined => {
  if (!current || !previous) return undefined
  const equipmentSensitive = isEquipmentSensitive(current) || isEquipmentSensitive(previous)
  const comparability = classifyExerciseComparability(equipmentSensitive, currentGymLocation, previousGymLocation)
  if (comparability.status === 'COMPARABLE') return undefined
  if (comparability.reason === 'MISSING_GYM_CONTEXT') {
    return { label: 'Brak informacji o siłowni — nie porównuję ciężaru', tone: 'neutral', incomparable: true }
  }
  return { label: 'Inna siłownia — nie porównuję ciężaru', tone: 'neutral', incomparable: true }
}

export const compareSets = (current?: WorkoutSet, previous?: WorkoutSet, prescription?: string): ProgressResult => {
  const comparison = classifySetPerformance(current, previous, prescription)
  switch (comparison.reason) {
    case 'MORE_REPS_SAME_LOAD':
      return { label: `+${comparison.repsDelta} powt.`, tone: 'positive' }
    case 'LOWER_REPS_SAME_LOAD':
      return { label: `${comparison.repsDelta} powt.`, tone: 'negative' }
    case 'SAME_LOAD_AND_REPS':
      return { label: 'bez zmiany', tone: 'neutral' }
    case 'LOAD_INCREASE_WITH_REPS_MAINTAINED':
      return { label: `+${formatDecimal(comparison.weightDelta)} kg`, tone: 'positive' }
    case 'LOAD_INCREASE_WITH_LOWER_REPS':
      return { label: `+${formatDecimal(comparison.weightDelta)} kg`, tone: 'neutral' }
    case 'LOAD_INCREASE_BELOW_REP_FLOOR':
      return { label: 'większy ciężar, poza zakresem', tone: 'warning' }
    case 'LOAD_DECREASE_WITH_MORE_REPS':
      return { label: 'więcej powt., niższy ciężar', tone: 'neutral' }
    case 'LOAD_DECREASE_WITHOUT_REP_IMPROVEMENT':
      return { label: `${formatDecimal(comparison.weightDelta)} kg`, tone: 'negative' }
    case 'INCOMPLETE_SET_DATA':
      return { label: '—', tone: 'neutral' }
  }
}

export const compareExercises = (
  current?: WorkoutExercise,
  previous?: WorkoutExercise,
  currentGymLocation?: string,
  previousGymLocation?: string,
): ProgressResult => {
  if (!current || !previous) return { label: '—', tone: 'neutral' }
  const currentBest = bestSetWithIndex(current)
  const previousBest = bestSetWithIndex(previous)
  if (!currentBest || !previousBest) return { label: '—', tone: 'neutral' }
  const comparisonIssue = equipmentComparisonIssue(current, previous, currentGymLocation, previousGymLocation)
  if (comparisonIssue) return comparisonIssue
  const bestResult = compareSets(currentBest?.set, previousBest?.set, current.prescription ?? previous.prescription)
  if (bestResult.tone === 'positive') return bestResult

  const sameBest = currentBest?.set.weight === previousBest?.set.weight && currentBest?.set.reps === previousBest?.set.reps
  if (!sameBest) return bestResult

  let workingRepsDelta = 0
  const pairedCount = Math.min(current.sets.length, previous.sets.length)
  for (let index = 0; index < pairedCount; index += 1) {
    if (index === currentBest?.index && index === previousBest?.index) continue
    const currentSet = current.sets[index]
    const previousSet = previous.sets[index]
    if (currentSet.weight === previousSet.weight && currentSet.reps !== undefined && previousSet.reps !== undefined) {
      workingRepsDelta += currentSet.reps - previousSet.reps
    }
  }
  if (workingRepsDelta > 0) return { label: `+${workingRepsDelta} powt. w seriach roboczych`, tone: 'positive' }
  return bestResult
}
