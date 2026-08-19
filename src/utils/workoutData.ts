import type { Workout, WorkoutExercise } from '../types'

export const replaceWorkoutById = (workouts: Workout[], updated: Workout) =>
  workouts.map((workout) => workout.id === updated.id ? updated : workout)

const normalizedExerciseName = (name: string) => name.trim().toLocaleLowerCase('pl-PL')

export const exercisesMatch = (candidate: WorkoutExercise, reference: WorkoutExercise) => {
  if (!candidate.isCustom && !reference.isCustom && candidate.id === reference.id) return true
  return normalizedExerciseName(candidate.name) === normalizedExerciseName(reference.name)
}

export const moveExercise = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) return items
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export interface ExerciseOccurrence {
  workout: Workout
  exercise: WorkoutExercise
}

const hasVisibleSet = (exercise: WorkoutExercise) => exercise.sets.some((set) => set.weight !== undefined || set.reps !== undefined)

const sameGym = (left?: string, right?: string) => Boolean(
  left?.trim() && right?.trim() && left.trim().localeCompare(right.trim(), 'pl', { sensitivity: 'accent' }) === 0,
)

export const previousExerciseOccurrence = (
  workouts: Workout[],
  reference: WorkoutExercise,
  beforeOrOn: string,
  gymLocation?: string,
  sensitivityCheck: (exercise: WorkoutExercise) => boolean = (exercise) => Boolean(exercise.equipmentSensitive),
) => {
  const occurrences: ExerciseOccurrence[] = [...workouts]
    .filter((workout) => workout.date <= beforeOrOn)
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap((workout) => workout.exercises.map((exercise) => ({ workout, exercise })))
    .filter((item) => exercisesMatch(item.exercise, reference) && !item.exercise.skipped && hasVisibleSet(item.exercise))
  const latest = occurrences[0]
  const equipmentSensitive = reference.equipmentSensitive
    ?? (sensitivityCheck(reference) || occurrences.some((item) => sensitivityCheck(item.exercise)))
  if (!equipmentSensitive) return { latest, comparable: latest }
  return {
    latest,
    comparable: gymLocation ? occurrences.find((item) => sameGym(item.workout.gymLocation, gymLocation)) : undefined,
  }
}
