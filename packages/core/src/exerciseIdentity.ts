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

export const normalizeAuthoritativeExerciseMention = (mention: string) => mention
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('pl-PL')

export type ExerciseMentionResolution =
  | { classification: 'RESOLVED'; exerciseId: string; authoritativeMention: string }
  | { classification: 'UNRESOLVED'; reason: 'NO_MENTION' | 'AMBIGUOUS_MENTION' | 'MULTIPLE_EXERCISES' | 'INVALID_DEFINITIONS' }

const containsExactMention = (source: string, mention: string) => {
  const normalized = normalizeAuthoritativeExerciseMention(mention)
  if (!normalized) return false
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u')
    .test(normalizeAuthoritativeExerciseMention(source))
}

/** Resolves identity only from canonical names and identity-owned aliases. */
export const resolveUniqueExerciseMention = (
  source: string,
  definitions: readonly Pick<ExerciseDefinition, 'id' | 'name' | 'aliases'>[],
): ExerciseMentionResolution => {
  if (!source.trim() || definitions.some((definition) => !definition.id.trim()
    || definition.id !== definition.id.trim()
    || definitions.filter((candidate) => candidate.id === definition.id).length !== 1)) {
    return { classification: 'UNRESOLVED', reason: 'INVALID_DEFINITIONS' }
  }
  const mentions = new Map<string, { display: Set<string>; exerciseIds: Set<string> }>()
  for (const definition of definitions) for (const mention of [definition.name, ...(definition.aliases ?? [])]) {
    if (typeof mention !== 'string') return { classification: 'UNRESOLVED', reason: 'INVALID_DEFINITIONS' }
    const normalized = normalizeAuthoritativeExerciseMention(mention)
    if (!normalized) return { classification: 'UNRESOLVED', reason: 'INVALID_DEFINITIONS' }
    const entry = mentions.get(normalized) ?? { display: new Set<string>(), exerciseIds: new Set<string>() }
    entry.display.add(mention.trim().replace(/\s+/g, ' ')); entry.exerciseIds.add(definition.id); mentions.set(normalized, entry)
  }
  const matched = [...mentions.entries()].filter(([, entry]) => containsExactMention(source, [...entry.display][0]))
  if (!matched.length) return { classification: 'UNRESOLVED', reason: 'NO_MENTION' }
  if (matched.some(([, entry]) => entry.exerciseIds.size !== 1)) return { classification: 'UNRESOLVED', reason: 'AMBIGUOUS_MENTION' }
  const exerciseIds = new Set(matched.flatMap(([, entry]) => [...entry.exerciseIds]))
  if (exerciseIds.size !== 1) return { classification: 'UNRESOLVED', reason: 'MULTIPLE_EXERCISES' }
  const selected = matched.map(([normalized, entry]) => ({ normalized, display: [...entry.display].sort()[0] }))
    .sort((left, right) => right.normalized.length - left.normalized.length || left.normalized.localeCompare(right.normalized, 'pl-PL'))[0]
  return { classification: 'RESOLVED', exerciseId: [...exerciseIds][0], authoritativeMention: selected.display }
}

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
