import type { ExerciseDefinition, WorkoutExercise, WorkoutSet } from '@greekgod/core'

// Active session only. Template mutations are a separate explicit workflow.
export const replaceSessionExercise = (exercises: WorkoutExercise[], occurrenceId: string, definition: ExerciseDefinition, emptySet: () => WorkoutSet) =>
  exercises.map((item) => item.id !== occurrenceId ? item : {
    ...item,
    exerciseId: definition.id,
    name: definition.name,
    equipmentSensitive: definition.equipmentSensitive,
    isCustom: true,
    sets: item.sets.map(() => emptySet()),
  })
