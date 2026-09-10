import { replaceTrainingTemplate } from '@greekgod/core'
import type { AppData, TrainingTemplate } from '../types'
import {
  registerExerciseDefinition,
  renameExerciseDefinition,
  resolveTemplateExerciseId,
} from './exerciseIdentity'

export const updateTemplateAndLibrary = (current: AppData, template: TrainingTemplate) => {
  const previousTemplate = current.templates.find((item) => item.id === template.id)
  let library = current.exerciseLibrary
  const changedSensitivityDefinitions = new Set<string>()

  const exercises = template.exercises.map((exercise) => {
    const previous = previousTemplate?.exercises.find((item) => item.id === exercise.id)
    const exerciseId = resolveTemplateExerciseId(exercise)
    if (!exerciseId) return previous ?? exercise

    let definition = library.find((item) => item.id === exerciseId)
    if (!definition) {
      if (previous) return previous
      library = registerExerciseDefinition(library, {
        id: exerciseId,
        name: exercise.name,
        equipmentSensitive: Boolean(exercise.equipmentSensitive),
      })
      definition = library.find((item) => item.id === exerciseId)!
    }

    const sameIdentity = previous?.exerciseId === exerciseId
    const sensitivityChanged = sameIdentity
      && Boolean(exercise.equipmentSensitive) !== definition.equipmentSensitive
    if (sensitivityChanged) {
      library = renameExerciseDefinition(
        library,
        exerciseId,
        definition.name,
        Boolean(exercise.equipmentSensitive),
      )
      changedSensitivityDefinitions.add(exerciseId)
      definition = library.find((item) => item.id === exerciseId)!
    }

    return {
      ...exercise,
      exerciseId,
      // A template slot never renames its shared ExerciseDefinition implicitly.
      name: definition.name,
      equipmentSensitive: definition.equipmentSensitive,
    }
  })

  const replacedTemplates = replaceTrainingTemplate(
    current.templates,
    { ...structuredClone(template), exercises },
  )
  const templates = replacedTemplates.map((item) => ({
    ...item,
    exercises: item.exercises.map((exercise) => {
      const exerciseId = exercise.exerciseId
      if (!exerciseId || !changedSensitivityDefinitions.has(exerciseId)) return exercise
      const definition = library.find((candidate) => candidate.id === exerciseId)
      return definition ? { ...exercise, equipmentSensitive: definition.equipmentSensitive } : exercise
    }),
  }))

  return { library, templates }
}
