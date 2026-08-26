import type { Workout } from './types'

export const addWorkout = (
  workouts: readonly Workout[],
  workout: Workout,
): Workout[] => [...workouts, workout]

export const updateWorkout = (
  workouts: readonly Workout[],
  workout: Workout,
): Workout[] => workouts.map((item) => item.id === workout.id ? workout : item)

export const deleteWorkout = (
  workouts: readonly Workout[],
  id: string,
): Workout[] => workouts.filter((workout) => workout.id !== id)

export const findWorkoutById = (
  workouts: readonly Workout[],
  id: string,
): Workout | undefined => workouts.find((workout) => workout.id === id)
