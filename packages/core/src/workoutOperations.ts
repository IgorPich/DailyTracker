import type { Workout } from './types'

export const addWorkout = (
  workouts: readonly Workout[],
  workout: Workout,
): Workout[] => [...workouts, workout]

export const updateWorkout = (
  workouts: readonly Workout[],
  workout: Workout,
): Workout[] => workouts.map((item) => item.id === workout.id ? workout : item)
