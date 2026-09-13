import type { AppData, TrainingTemplate } from './types.ts'

export interface TemplateRepRangePlan {
  action: 'CHANGE_TEMPLATE_REP_RANGE'
  templateId: string
  templateExerciseId: string
  exerciseId: string
  expectedTemplateState: string
  beforePrescription: string
  afterPrescription: string
  minReps: number
  maxReps: number
}

export const templateStateVersion = (template: TrainingTemplate): string => JSON.stringify(template)

export const prepareTemplateRepRange = (
  data: Pick<AppData, 'templates' | 'exerciseLibrary'>,
  target: { templateId: string; templateExerciseId: string; exerciseId: string },
  minReps: number, maxReps: number,
): TemplateRepRangePlan => {
  if (!Number.isSafeInteger(minReps) || !Number.isSafeInteger(maxReps) || minReps < 1 || maxReps < minReps) throw new Error('Invalid rep range')
  const templates = data.templates.filter((item) => item.id === target.templateId)
  if (templates.length !== 1) throw new Error('Unknown or ambiguous template')
  const rows = templates[0].exercises.filter((item) => item.id === target.templateExerciseId)
  if (rows.length !== 1 || rows[0].exerciseId !== target.exerciseId
    || data.exerciseLibrary.filter((item) => item.id === target.exerciseId).length !== 1) throw new Error('Unknown or ambiguous exercise identity')
  const prescription = rows[0].prescription
  // Structured prescription grammar, NOT natural-language command parsing.
  // Complex/multiple ranges are deliberately unsupported: never flatten their semantics.
  const match = /^(\s*(?:\d+\s*[×x]\s*)?)(\d+)\s*[–-]\s*(\d+)(\s*)$/.exec(prescription)
  if (!match || Number(match[2]) < 1 || Number(match[3]) < Number(match[2])) throw new Error('Unsupported prescription: a single simple rep range is required')
  return { action: 'CHANGE_TEMPLATE_REP_RANGE', templateId: target.templateId, templateExerciseId: target.templateExerciseId,
    exerciseId: target.exerciseId, expectedTemplateState: templateStateVersion(templates[0]),
    beforePrescription: prescription, afterPrescription: `${match[1]}${minReps}–${maxReps}${match[4]}`, minReps, maxReps }
}

export const changeTemplateRepRange = (data: AppData, plan: TemplateRepRangePlan): AppData => {
  const current = prepareTemplateRepRange(data, plan, plan.minReps, plan.maxReps)
  if (JSON.stringify(current) !== JSON.stringify(plan)) throw new Error('STALE_OR_INVALID_PLAN')
  return { ...data, templates: data.templates.map((template) => template.id !== plan.templateId ? template : {
    ...template, exercises: template.exercises.map((row) => row.id !== plan.templateExerciseId ? row : { ...row, prescription: plan.afterPrescription }),
  }) }
}
