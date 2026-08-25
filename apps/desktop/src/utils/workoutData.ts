import type { Workout, WorkoutExercise } from '../types'
import { canonicalExerciseId } from './exerciseIdentity'

export const replaceWorkoutById = (workouts: Workout[], updated: Workout) =>
  workouts.map((workout) => workout.id === updated.id ? updated : workout)

export const exercisesMatch = (candidate: WorkoutExercise, reference: WorkoutExercise) =>
  canonicalExerciseId(candidate) === canonicalExerciseId(reference)

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

export const mergeWorkoutExercises = (
  exercises: WorkoutExercise[],
  sensitivityCheck: (exercise: WorkoutExercise) => boolean = (exercise) => Boolean(exercise.equipmentSensitive),
): WorkoutExercise | undefined => {
  if (!exercises.length) return undefined
  if (exercises.length === 1) return exercises[0]
  return {
    ...exercises[0],
    sets: exercises.flatMap((exercise) => exercise.sets),
    equipmentSensitive: exercises.some((exercise) => sensitivityCheck(exercise)),
  }
}

export const exerciseOccurrencesByWorkout = (
  workouts: Workout[],
  matches: (exercise: WorkoutExercise) => boolean,
  sensitivityCheck: (exercise: WorkoutExercise) => boolean = (exercise) => Boolean(exercise.equipmentSensitive),
): ExerciseOccurrence[] => workouts.flatMap((workout) => {
  const exercise = mergeWorkoutExercises(
    workout.exercises.filter((candidate) => matches(candidate) && !candidate.skipped && hasVisibleSet(candidate)),
    sensitivityCheck,
  )
  return exercise ? [{ workout, exercise }] : []
})

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
  const occurrences = exerciseOccurrencesByWorkout(
    [...workouts]
      .filter((workout) => workout.date <= beforeOrOn)
      .sort((a, b) => b.date.localeCompare(a.date)),
    (exercise) => exercisesMatch(exercise, reference),
    sensitivityCheck,
  )
  const latest = occurrences[0]
  const equipmentSensitive = sensitivityCheck(reference) || occurrences.some((item) => sensitivityCheck(item.exercise))
  if (!equipmentSensitive) return { latest, comparable: latest }
  return {
    latest,
    comparable: gymLocation ? occurrences.find((item) => sameGym(item.workout.gymLocation, gymLocation)) : undefined,
  }
}
