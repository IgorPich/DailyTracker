import type { TrainingTemplate } from '../types'

export const upgradeBuiltInTemplates = (
  templates: TrainingTemplate[],
  defaults: TrainingTemplate[],
): TrainingTemplate[] => templates.map((template) => {
  if (!template || !Array.isArray(template.exercises)) return template
  const currentDefault = defaults.find((item) => item.id === template.id)
  if (!currentDefault) return template
  return {
    ...template,
    name: currentDefault.name,
    exercises: template.exercises.map((item) => {
      const upgraded = currentDefault.exercises.find((exercise) => exercise.id === item.id)
      if (!upgraded) return item
      return {
        ...item,
        name: upgraded.name,
        prescription: upgraded.prescription,
        defaultSets: upgraded.defaultSets,
        ...(item.equipmentSensitive === undefined && upgraded.equipmentSensitive ? { equipmentSensitive: true } : {}),
      }
    }),
  }
})
