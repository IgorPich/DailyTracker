import type { ExerciseDefinition, Workout, WorkoutExercise } from './types'
import { classifyExerciseComparability } from './exerciseComparability.ts'
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
  exercises: WorkoutExercise[]
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
    const exercises = workout.exercises.filter((candidate) => (
      resolvedExerciseDefinitionId(exerciseLibrary, candidate) === exerciseId
      && !candidate.skipped
      && hasVisibleSet(candidate)
    ))
    const exercise = mergeWorkoutExercises(exercises, sensitivityCheck)
    return exercise ? [{ workout, exercise, exercises }] : []
  })
}

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
    comparable: occurrences.find((item) => (
      classifyExerciseComparability(true, item.workout.gymLocation, options.gymLocation).status === 'COMPARABLE'
    )),
  }
}
