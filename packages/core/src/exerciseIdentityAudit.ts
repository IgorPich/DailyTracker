import type { AppData } from './types.ts'
import {
  classifyExerciseIdentity,
  UNRESOLVED_EXERCISE_IDENTITY,
  type ExerciseIdentityIssueReason,
} from './exerciseIdentity.ts'

export interface ExerciseIdentityAuditIssue {
  classification: typeof UNRESOLVED_EXERCISE_IDENTITY
  reason: ExerciseIdentityIssueReason
  source: 'template' | 'workout'
  sourceId: string
  occurrenceId: string
  exerciseId?: string
}

export interface ExerciseIdentityAuditResult {
  totalReferences: number
  resolvedReferences: number
  unresolvedReferences: number
  issues: ExerciseIdentityAuditIssue[]
}

export const auditExerciseIdentities = (
  data: Pick<AppData, 'exerciseLibrary' | 'templates' | 'workouts'>,
): ExerciseIdentityAuditResult => {
  const issues: ExerciseIdentityAuditIssue[] = []
  let totalReferences = 0

  const inspect = (
    source: ExerciseIdentityAuditIssue['source'],
    sourceId: string,
    exercise: { id: string; exerciseId?: string },
  ) => {
    totalReferences += 1
    const resolution = classifyExerciseIdentity(data.exerciseLibrary, exercise)
    if (resolution.classification === 'RESOLVED') return
    issues.push({
      classification: UNRESOLVED_EXERCISE_IDENTITY,
      reason: resolution.reason,
      source,
      sourceId,
      occurrenceId: exercise.id,
      ...(resolution.exerciseId === undefined ? {} : { exerciseId: resolution.exerciseId }),
    })
  }

  data.templates.forEach((template) => template.exercises.forEach((exercise) => inspect('template', template.id, exercise)))
  data.workouts.forEach((workout) => workout.exercises.forEach((exercise) => inspect('workout', workout.id, exercise)))

  return {
    totalReferences,
    resolvedReferences: totalReferences - issues.length,
    unresolvedReferences: issues.length,
    issues,
  }
}
