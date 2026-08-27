import type { ExerciseDefinition, TemplateExercise, WorkoutExercise } from './types'

export type ExerciseReference = Pick<WorkoutExercise, 'id' | 'exerciseId' | 'name' | 'equipmentSensitive'>
  | Pick<TemplateExercise, 'id' | 'exerciseId' | 'name' | 'equipmentSensitive'>

export const normalizeExerciseName = (name: string) => name
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('pl-PL')

export const canonicalExerciseId = (exercise: Pick<ExerciseReference, 'id' | 'exerciseId'>) =>
  exercise.exerciseId?.trim() || exercise.id

const definitionNames = (definition: ExerciseDefinition) => [definition.name, ...(definition.aliases ?? [])]

export const matchingExerciseDefinitionsByName = (library: ExerciseDefinition[], name: string) => {
  const normalized = normalizeExerciseName(name)
  if (!normalized) return []
  return library.filter((definition) => definitionNames(definition)
    .some((candidate) => normalizeExerciseName(candidate) === normalized))
}

export const findExerciseDefinitionByName = (library: ExerciseDefinition[], name: string) => {
  const matches = matchingExerciseDefinitionsByName(library, name)
  return matches.length === 1 ? matches[0] : undefined
}

export const exerciseDefinitionFor = (
  library: ExerciseDefinition[],
  exercise?: Pick<ExerciseReference, 'id' | 'exerciseId'>,
) => exercise ? library.find((definition) => definition.id === canonicalExerciseId(exercise)) : undefined

const uniqueNameList = (names: string[]) => {
  const seen = new Set<string>()
  return names.filter((name) => {
    const normalized = normalizeExerciseName(name)
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

const availableDefinitionId = (library: ExerciseDefinition[], preferredId: string) => {
  if (!library.some((definition) => definition.id === preferredId)) return preferredId
  let suffix = 2
  while (library.some((definition) => definition.id === `${preferredId}-${suffix}`)) suffix += 1
  return `${preferredId}-${suffix}`
}

export const withRegisteredExercise = (
  library: ExerciseDefinition[],
  name: string,
  equipmentSensitive: boolean,
  preferredId: string,
): { definition: ExerciseDefinition; library: ExerciseDefinition[] } => {
  const matches = matchingExerciseDefinitionsByName(library, name)
  if (matches.length > 1) throw new Error('Ta nazwa pasuje do kilku odrębnych ćwiczeń. Wybierz konkretną pozycję z biblioteki.')
  const existing = matches[0]
  if (existing) return { definition: existing, library }
  const definition: ExerciseDefinition = {
    id: availableDefinitionId(library, preferredId),
    name: name.trim().replace(/\s+/g, ' '),
    equipmentSensitive,
  }
  return { definition, library: [...library, definition] }
}

export const renameExerciseDefinition = (
  library: ExerciseDefinition[],
  exerciseId: string,
  name: string,
  equipmentSensitive: boolean,
) => {
  const collision = matchingExerciseDefinitionsByName(library, name)
    .some((definition) => definition.id !== exerciseId)
  if (collision) throw new Error('Ta nazwa należy już do innego ćwiczenia. Użyj operacji „Zamień ćwiczenie”.')
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
