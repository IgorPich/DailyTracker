import type { ExerciseDefinition, Workout, WorkoutExercise } from './types'
import {
  resolvedExerciseDefinitionId,
  UNRESOLVED_EXERCISE_IDENTITY,
} from './exerciseIdentity.ts'

export { moveItem as moveExercise } from './templateOperations.ts'
export { updateWorkout as replaceWorkoutById } from './workoutOperations.ts'

export const exercisesMatch = (
  candidate: WorkoutExercise,
  reference: WorkoutExercise,
  exerciseLibrary: readonly ExerciseDefinition[],
) => {
  const candidateId = resolvedExerciseDefinitionId(exerciseLibrary, candidate)
  const referenceId = resolvedExerciseDefinitionId(exerciseLibrary, reference)
  return Boolean(candidateId && referenceId && candidateId === referenceId)
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
  exerciseId: string | undefined,
  exerciseLibrary: readonly ExerciseDefinition[],
  sensitivityCheck: (exercise: WorkoutExercise) => boolean = (exercise) => Boolean(exercise.equipmentSensitive),
): ExerciseOccurrence[] => {
  if (!exerciseId || !exerciseLibrary.some((definition) => definition.id === exerciseId)) return []
  return workouts.flatMap((workout) => {
    const exercise = mergeWorkoutExercises(
      workout.exercises.filter((candidate) => (
        resolvedExerciseDefinitionId(exerciseLibrary, candidate) === exerciseId
        && !candidate.skipped
        && hasVisibleSet(candidate)
      )),
      sensitivityCheck,
    )
    return exercise ? [{ workout, exercise }] : []
  })
}

const sameGym = (left?: string, right?: string) => Boolean(
  left?.trim() && right?.trim() && left.trim().localeCompare(right.trim(), 'pl', { sensitivity: 'accent' }) === 0,
)

export const previousExerciseOccurrence = (
  workouts: Workout[],
  reference: WorkoutExercise,
  options: {
    beforeOrOn: string
    exerciseLibrary: readonly ExerciseDefinition[]
    gymLocation?: string
    sensitivityCheck?: (exercise: WorkoutExercise) => boolean
  },
) => {
  const exerciseId = resolvedExerciseDefinitionId(options.exerciseLibrary, reference)
  if (!exerciseId) {
    return {
      latest: undefined,
      comparable: undefined,
      identityIssue: UNRESOLVED_EXERCISE_IDENTITY,
    }
  }
  const sensitivityCheck = options.sensitivityCheck
    ?? ((exercise: WorkoutExercise) => Boolean(exercise.equipmentSensitive))
  const occurrences = exerciseOccurrencesByWorkout(
    [...workouts]
      .filter((workout) => workout.date <= options.beforeOrOn)
      .sort((a, b) => b.date.localeCompare(a.date)),
    exerciseId,
    options.exerciseLibrary,
    sensitivityCheck,
  )
  const latest = occurrences[0]
  const equipmentSensitive = sensitivityCheck(reference) || occurrences.some((item) => sensitivityCheck(item.exercise))
  if (!equipmentSensitive) return { latest, comparable: latest }
  return {
    latest,
    comparable: options.gymLocation ? occurrences.find((item) => sameGym(item.workout.gymLocation, options.gymLocation)) : undefined,
  }
}
