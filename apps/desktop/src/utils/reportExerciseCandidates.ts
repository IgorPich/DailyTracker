import type { ExerciseDefinition, TrainingTemplate } from '../types'
import { resolvedExerciseDefinitionId } from './exerciseIdentity'

export const activeReportExerciseDefinitions = (
  templates: readonly TrainingTemplate[],
  exerciseLibrary: readonly ExerciseDefinition[],
): ExerciseDefinition[] => {
  const seen = new Set<string>()
  const candidates: ExerciseDefinition[] = []

  for (const template of templates) {
    for (const exercise of template.exercises) {
      const exerciseId = resolvedExerciseDefinitionId(exerciseLibrary, exercise)
      if (!exerciseId || seen.has(exerciseId)) continue
      const definition = exerciseLibrary.find((item) => item.id === exerciseId)
      if (!definition) continue
      seen.add(exerciseId)
      candidates.push(definition)
    }
  }

  return candidates
}
