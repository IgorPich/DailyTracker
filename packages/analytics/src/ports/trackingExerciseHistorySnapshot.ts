import type { ExerciseDefinition, Workout } from '@greekgod/core'

export interface TrackingExerciseHistorySnapshot {
  exerciseLibrary: readonly ExerciseDefinition[]
  workouts: readonly Workout[]
}
