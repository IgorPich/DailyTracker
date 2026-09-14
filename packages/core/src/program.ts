import type { AppData, ExerciseDefinition, TrainingTemplate } from './types.ts'
import { moveItem } from './templateOperations.ts'

export interface ProgramPlan { baseline: string; templates: TrainingTemplate[] }
/** Object-key order is not program order. Array order IS persisted user configuration. */
export const programVersion = (templates: readonly TrainingTemplate[]): string => JSON.stringify(templates, (_key, value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  return value
})
export const openProgramDraft = (templates: TrainingTemplate[]): ProgramPlan => ({ baseline: programVersion(templates), templates: structuredClone(templates) })
const text = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) throw new Error(`Invalid ${label}`)
}
const identity = (value: unknown) => { text(value, 'identity'); if ((value as string).trim() !== value) throw new Error('Invalid identity whitespace') }
export const validateProgram = (templates: TrainingTemplate[], library: ExerciseDefinition[]) => {
  if (!Array.isArray(templates) || !templates.length || templates.length > 100) throw new Error('Program requires 1–100 templates')
  const templateIds = new Set<string>()
  for (const template of templates) {
    identity(template.id); text(template.name, 'template name'); text(template.code, 'template label')
    if (templateIds.has(template.id)) throw new Error('Duplicate template identity')
    templateIds.add(template.id)
    if (!Array.isArray(template.exercises) || template.exercises.length > 200) throw new Error('Invalid exercise list')
    const slots = new Set<string>()
    for (const slot of template.exercises) {
      identity(slot.id); identity(slot.exerciseId)
      if (slots.has(slot.id)) throw new Error('Duplicate template slot')
      slots.add(slot.id)
      if (library.filter((definition) => definition.id === slot.exerciseId).length !== 1) throw new Error('Unresolved ExerciseDefinitionId')
      text(slot.name, 'exercise snapshot name'); text(slot.prescription, 'prescription')
      // Existing prescriptions are free text (including complex ranges). Preserve that contract.
      // Reject malformed values, not valid legacy notation or user-authored instructions.
      if (!Number.isSafeInteger(slot.defaultSets) || slot.defaultSets < 1 || slot.defaultSets > 100) throw new Error('Invalid set count')
      if (slot.equipmentSensitive !== undefined && typeof slot.equipmentSensitive !== 'boolean') throw new Error('Invalid equipment sensitivity')
    }
  }
}
export const applyProgram = (current: AppData, plan: ProgramPlan): AppData => {
  if (programVersion(current.templates) !== plan.baseline) throw new Error('STALE_PROGRAM')
  validateProgram(plan.templates, current.exerciseLibrary)
  return { ...current, templates: structuredClone(plan.templates) }
}
export const duplicateProgramTemplate = (template: TrainingTemplate, newId: () => string): TrainingTemplate => ({
  ...structuredClone(template), id: newId(), exercises: template.exercises.map((slot) => ({ ...structuredClone(slot), id: newId() })),
})
export const reorderProgramItems = <T,>(items: readonly T[], from: number, to: number): T[] => {
  const next = [...items]
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= next.length || to >= next.length) return next
  return moveItem(next, from, to)
}
