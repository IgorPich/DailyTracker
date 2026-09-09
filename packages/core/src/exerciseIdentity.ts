import type { ExerciseDefinition, TemplateExercise, WorkoutExercise } from './types'

export type ExerciseReference = Pick<WorkoutExercise, 'id' | 'exerciseId' | 'name' | 'equipmentSensitive'>
  | Pick<TemplateExercise, 'id' | 'exerciseId' | 'name' | 'equipmentSensitive'>

export const UNRESOLVED_EXERCISE_IDENTITY = 'UNRESOLVED_EXERCISE_IDENTITY' as const

export type ExerciseIdentityIssueReason =
  | 'MISSING_EXERCISE_ID'
  | 'INVALID_EXERCISE_ID'
  | 'UNKNOWN_EXERCISE_DEFINITION'
  | 'DUPLICATE_EXERCISE_DEFINITION_ID'

export type ExerciseIdentityResolution =
  | { classification: 'RESOLVED'; exerciseId: string }
  | {
      classification: typeof UNRESOLVED_EXERCISE_IDENTITY
      exerciseId?: string
      reason: ExerciseIdentityIssueReason
    }

export const normalizeExerciseName = (name: string) => name
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('pl-PL')

export const canonicalExerciseId = (
  exercise: Pick<ExerciseReference, 'exerciseId'>,
): string | undefined => {
  const exerciseId = exercise.exerciseId
  if (typeof exerciseId !== 'string' || !exerciseId.trim()) return undefined
  return exerciseId === exerciseId.trim() ? exerciseId : undefined
}

export const classifyExerciseIdentity = (
  library: readonly ExerciseDefinition[],
  exercise: Pick<ExerciseReference, 'exerciseId'>,
): ExerciseIdentityResolution => {
  const suppliedId = exercise.exerciseId
  if (typeof suppliedId !== 'string' || !suppliedId.trim()) {
    return { classification: UNRESOLVED_EXERCISE_IDENTITY, reason: 'MISSING_EXERCISE_ID' }
  }
  const exerciseId = canonicalExerciseId(exercise)
  if (!exerciseId) {
    return {
      classification: UNRESOLVED_EXERCISE_IDENTITY,
      exerciseId: suppliedId,
      reason: 'INVALID_EXERCISE_ID',
    }
  }
  const definitions = library.filter((definition) => definition.id === exerciseId)
  if (!definitions.length) {
    return {
      classification: UNRESOLVED_EXERCISE_IDENTITY,
      exerciseId,
      reason: 'UNKNOWN_EXERCISE_DEFINITION',
    }
  }
  if (definitions.length > 1) {
    return {
      classification: UNRESOLVED_EXERCISE_IDENTITY,
      exerciseId,
      reason: 'DUPLICATE_EXERCISE_DEFINITION_ID',
    }
  }
  return { classification: 'RESOLVED', exerciseId }
}

export const resolvedExerciseDefinitionId = (
  library: readonly ExerciseDefinition[],
  exercise: Pick<ExerciseReference, 'exerciseId'>,
) => {
  const resolution = classifyExerciseIdentity(library, exercise)
  return resolution.classification === 'RESOLVED' ? resolution.exerciseId : undefined
}

export const exerciseDefinitionFor = (
  library: readonly ExerciseDefinition[],
  exercise?: Pick<ExerciseReference, 'exerciseId'>,
) => {
  if (!exercise) return undefined
  const exerciseId = resolvedExerciseDefinitionId(library, exercise)
  return exerciseId ? library.find((definition) => definition.id === exerciseId) : undefined
}

export const resolveTemplateExerciseId = (
  exercise: TemplateExercise,
) => canonicalExerciseId(exercise)

const uniqueNameList = (names: string[]) => {
  const seen = new Set<string>()
  return names.filter((name) => {
    const normalized = normalizeExerciseName(name)
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

export const registerExerciseDefinition = (
  library: readonly ExerciseDefinition[],
  definition: ExerciseDefinition,
): ExerciseDefinition[] => {
  const exerciseId = definition.id.trim()
  if (!exerciseId || exerciseId !== definition.id) throw new Error('Nowe ćwiczenie wymaga prawidłowego ExerciseDefinitionId.')
  if (library.some((item) => item.id === exerciseId)) throw new Error('ExerciseDefinitionId już istnieje w bibliotece.')
  return [...library, {
    ...definition,
    name: definition.name.trim().replace(/\s+/g, ' '),
  }]
}

export const renameExerciseDefinition = (
  library: ExerciseDefinition[],
  exerciseId: string,
  name: string,
  equipmentSensitive: boolean,
) => {
  return library.map((definition) => {
    if (definition.id !== exerciseId) return definition
    const nextName = name.trim().replace(/\s+/g, ' ')
    const aliases = uniqueNameList([
      ...(definition.aliases ?? []),
      ...(normalizeExerciseName(definition.name) === normalizeExerciseName(nextName) ? [] : [definition.name]),
    ]).filter((alias) => normalizeExerciseName(alias) !== normalizeExerciseName(nextName))
    return {
      ...definition,
      name: nextName,
      equipmentSensitive,
      ...(aliases.length ? { aliases } : { aliases: undefined }),
    }
  })
}
