import type { ExerciseDefinition, TemplateExercise, TrainingTemplate } from './types'

export const moveItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) {
    return items
  }
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export const removeTemplateExercise = (
  exercises: readonly TemplateExercise[],
  id: string,
): TemplateExercise[] => exercises.filter((exercise) => exercise.id !== id)

export const insertTemplateExercise = (
  exercises: readonly TemplateExercise[],
  exercise: TemplateExercise,
  oneBasedPosition: number,
): TemplateExercise[] => {
  const next = [...exercises]
  const safePosition = Number.isFinite(oneBasedPosition) ? oneBasedPosition : next.length + 1
  next.splice(Math.max(0, Math.min(next.length, safePosition - 1)), 0, exercise)
  return next
}

export const replaceTemplateExerciseDefinition = (
  exercises: readonly TemplateExercise[],
  slotId: string,
  definition: ExerciseDefinition,
): TemplateExercise[] => exercises.map((exercise) => exercise.id !== slotId ? exercise : {
  ...exercise,
  exerciseId: definition.id,
  name: definition.name,
  equipmentSensitive: definition.equipmentSensitive,
})

export const replaceTrainingTemplate = (
  templates: readonly TrainingTemplate[],
  template: TrainingTemplate,
): TrainingTemplate[] => templates.map((item) => item.id === template.id ? template : item)
