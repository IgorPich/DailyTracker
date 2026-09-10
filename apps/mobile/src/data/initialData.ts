import { DEFAULT_TEMPLATES, type AppData, type ExerciseDefinition } from '@greekgod/core'

const exerciseLibrary = DEFAULT_TEMPLATES
  .flatMap((template) => template.exercises)
  .reduce<ExerciseDefinition[]>((definitions, exercise) => {
    const id = exercise.exerciseId
    if (!id) return definitions
    if (definitions.some((item) => item.id === id)) return definitions
    return [...definitions, {
      id,
      name: exercise.name,
      equipmentSensitive: Boolean(exercise.equipmentSensitive),
    }]
  }, [])

export const INITIAL_MOBILE_DATA: AppData = {
  version: 4,
  dailyEntries: [],
  workouts: [],
  templates: structuredClone(DEFAULT_TEMPLATES),
  exerciseLibrary,
  settings: {
    phase: 'Maintenance',
    calorieTarget: 2800,
    proteinTarget: 160,
    trendThresholds: {
      lossBelow: -0.15,
      stableUpper: 0.05,
      slowGainUpper: 0.2,
    },
  },
  coachNotes: {},
}
