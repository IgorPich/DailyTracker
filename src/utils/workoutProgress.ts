import type { WorkoutExercise, WorkoutSet } from '../types'
import { formatDecimal } from './numbers'

export interface ProgressResult {
  label: string
  positive: boolean
  incomparable?: boolean
}

interface RepRange {
  min: number
  max: number
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

export const isEquipmentSensitive = (exercise?: WorkoutExercise) => Boolean(
  exercise && (exercise.equipmentSensitive ?? BUILTIN_EQUIPMENT_SENSITIVE_IDS.has(exercise.id)),
)

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

const normalizedGymName = (name?: string) => name?.trim().toLocaleLowerCase('pl-PL') || undefined

export const formatGymName = (name?: string) => name?.trim() || 'nie podano'

export const equipmentComparisonIssue = (
  current: WorkoutExercise | undefined,
  previous: WorkoutExercise | undefined,
  currentGymLocation?: string,
  previousGymLocation?: string,
): ProgressResult | undefined => {
  if (!current || !previous) return undefined
  const equipmentSensitive = current.equipmentSensitive
    ?? previous.equipmentSensitive
    ?? (isEquipmentSensitive(current) || isEquipmentSensitive(previous))
  if (!equipmentSensitive) return undefined
  const currentGym = normalizedGymName(currentGymLocation)
  const previousGym = normalizedGymName(previousGymLocation)
  if (!currentGym || !previousGym) {
    return { label: 'Brak informacji o siłowni — nie porównuję ciężaru', positive: false, incomparable: true }
  }
  if (currentGym !== previousGym) {
    return { label: 'Inna siłownia — nie porównuję ciężaru', positive: false, incomparable: true }
  }
  return undefined
}

export const compareSets = (current?: WorkoutSet, previous?: WorkoutSet, prescription?: string): ProgressResult => {
  if (!current || !previous || current.weight === undefined || current.reps === undefined || previous.weight === undefined || previous.reps === undefined) {
    return { label: '—', positive: false }
  }

  const weightDelta = Number((current.weight - previous.weight).toFixed(2))
  const repsDelta = current.reps - previous.reps

  if (weightDelta === 0) {
    if (repsDelta > 0) return { label: `+${repsDelta} powt.`, positive: true }
    if (repsDelta < 0) return { label: `${repsDelta} powt.`, positive: false }
    return { label: 'bez zmiany', positive: false }
  }

  if (weightDelta > 0) {
    const range = prescriptionRepRange(prescription)
    const sensibleFloor = range?.min ?? Math.max(1, previous.reps - 2)
    if (current.reps < sensibleFloor) return { label: 'większy ciężar, poza zakresem', positive: false }
    return { label: `+${formatDecimal(weightDelta)} kg`, positive: true }
  }

  return { label: repsDelta > 0 ? 'więcej powt., niższy ciężar' : `${formatDecimal(weightDelta)} kg`, positive: false }
}

export const compareExercises = (
  current?: WorkoutExercise,
  previous?: WorkoutExercise,
  currentGymLocation?: string,
  previousGymLocation?: string,
): ProgressResult => {
  if (!current || !previous) return { label: '—', positive: false }
  const currentBest = bestSetWithIndex(current)
  const previousBest = bestSetWithIndex(previous)
  if (!currentBest || !previousBest) return { label: '—', positive: false }
  const comparisonIssue = equipmentComparisonIssue(current, previous, currentGymLocation, previousGymLocation)
  if (comparisonIssue) return comparisonIssue
  const bestResult = compareSets(currentBest?.set, previousBest?.set, current.prescription ?? previous.prescription)
  if (bestResult.positive) return bestResult

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
  if (workingRepsDelta > 0) return { label: `+${workingRepsDelta} powt. w seriach roboczych`, positive: true }
  return bestResult
}
