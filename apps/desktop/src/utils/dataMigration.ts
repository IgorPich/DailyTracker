import type { ExerciseDefinition, TrainingTemplate, Workout } from '../types'
import { normalizeExerciseName } from './exerciseIdentity'

/**
 * LEGACY BACKUP RESTORE BOUNDARY.
 *
 * Name, alias and occurrence-ID compatibility below exists only to import data
 * written before the canonical exercise-library format. Runtime selectors and
 * 4.0 identity decisions must not depend on this module.
 */

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

interface IdentityObservation {
  legacyId: string
  name: string
  normalizedName: string
  explicitExerciseId?: string
  equipmentSensitive?: boolean
  source: 'template' | 'workout'
  sourceOrder: number
}

interface KnownExerciseIdentity {
  id: string
  name: string
  equipmentSensitive: boolean
}

const knownExerciseIdentities = new Map<string, KnownExerciseIdentity>([
  ['Wiosło na wyciągu', { id: 'chest-supported-row', name: 'Wiosło na wyciągu', equipmentSensitive: true }],
  ['Wiosło na maszynie', { id: 'machine-row', name: 'Wiosło na maszynie', equipmentSensitive: true }],
  ['Odwrotne rozpiętki na maszynie', { id: 'rear-delt-machine', name: 'Odwrotne rozpiętki na maszynie', equipmentSensitive: true }],
  ['Unoszenie bokiem z hantalmi', { id: 'dumbbell-lateral-raise', name: 'Unoszenie bokiem z hantlami', equipmentSensitive: false }],
  ['Unoszenie bokiem z hantlami', { id: 'dumbbell-lateral-raise', name: 'Unoszenie bokiem z hantlami', equipmentSensitive: false }],
  ['Prostowanie ramion nad głową z sztangą na leżąco', { id: 'overhead-triceps-extension', name: 'Prostowanie ramion nad głową z sztangą na leżąco', equipmentSensitive: false }],
].map(([name, identity]) => [normalizeExerciseName(name as string), identity as KnownExerciseIdentity]))

const legacyNameAliasKey = (legacyId: string, name: string) => `${legacyId}\u0000${normalizeExerciseName(name)}`

const knownLegacyNameAliases = new Map<string, string>([
  ['bench-press', 'Bench Press'],
  ['incline-dumbbell-press', 'Incline Dumbbell Press'],
  ['cable-fly', 'Cable Fly Low-to-High'],
  ['lateral-raise-machine', 'Lateral Raise Machine'],
  ['rope-pushdown', 'Rope Pushdown'],
  ['cable-crunch', 'Cable Crunch'],
  ['pull-up', 'Pull-Up / Weighted Pull-Up'],
  ['single-arm-lat-pulldown', 'Single-Arm Lat Pulldown'],
  ['straight-arm-pulldown', 'Straight-Arm Pulldown'],
  ['rear-delt-machine', 'Rear Delt Machine'],
  ['ez-curl', 'EZ / Barbell Curl'],
  ['bayesian-curl', 'Bayesian Cable Curl'],
  ['reverse-curl', 'Reverse Curl'],
  ['wrist-curl', 'Wrist Curl'],
].map(([legacyId, name]) => [legacyNameAliasKey(legacyId, name), legacyId]))

const preferredLegacyId = (ids: string[]) => [...new Set(ids)].sort((left, right) => {
  const rank = (id: string) => id.startsWith('custom-') ? 3 : id.endsWith('-d') ? 1 : 0
  return rank(left) - rank(right) || left.length - right.length || left.localeCompare(right)
})[0]

const deterministicNameSuffix = (name: string) => {
  let value = 2166136261
  for (let index = 0; index < name.length; index += 1) {
    value ^= name.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return (value >>> 0).toString(36)
}

const uniqueNames = (names: string[]) => {
  const seen = new Set<string>()
  return names.filter((name) => {
    const normalized = normalizeExerciseName(name)
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

const findLegacyDefinitionByExactName = (library: ExerciseDefinition[], name: string) => {
  const normalized = normalizeExerciseName(name)
  const matches = library.filter((definition) => [definition.name, ...(definition.aliases ?? [])]
    .some((candidate) => normalizeExerciseName(candidate) === normalized))
  return matches.length === 1 ? matches[0] : undefined
}

export interface ExerciseIdentityMigration {
  templates: TrainingTemplate[]
  workouts: Workout[]
  exerciseLibrary: ExerciseDefinition[]
}

export const migrateLegacyExerciseIdentity = (
  templates: TrainingTemplate[],
  workouts: Workout[],
  existingLibrary: ExerciseDefinition[] = [],
): ExerciseIdentityMigration => {
  let sourceOrder = 0
  const observations: IdentityObservation[] = [
    ...templates.flatMap((template) => template.exercises.map((exercise) => ({
      legacyId: exercise.id,
      name: exercise.name,
      normalizedName: normalizeExerciseName(exercise.name),
      explicitExerciseId: exercise.exerciseId?.trim() || undefined,
      equipmentSensitive: exercise.equipmentSensitive,
      source: 'template' as const,
      sourceOrder: sourceOrder++,
    }))),
    ...workouts.flatMap((workout) => workout.exercises.map((exercise) => ({
      legacyId: exercise.id,
      name: exercise.name,
      normalizedName: normalizeExerciseName(exercise.name),
      explicitExerciseId: exercise.exerciseId?.trim() || undefined,
      equipmentSensitive: exercise.equipmentSensitive,
      source: 'workout' as const,
      sourceOrder: sourceOrder++,
    }))),
  ]

  const exactGroups = observations.reduce((groups, observation) => {
    const group = groups.get(observation.normalizedName) ?? []
    group.push(observation)
    groups.set(observation.normalizedName, group)
    return groups
  }, new Map<string, IdentityObservation[]>())

  const exactGroupCanonical = new Map<string, string>()
  exactGroups.forEach((group, normalizedName) => {
    const known = knownExerciseIdentities.get(normalizedName)
    if (known) {
      exactGroupCanonical.set(normalizedName, known.id)
      return
    }
    const explicitIds = [...new Set(group.map((item) => item.explicitExerciseId).filter((id): id is string => Boolean(id)))]
    if (explicitIds.length === 1) {
      exactGroupCanonical.set(normalizedName, explicitIds[0])
      return
    }
    if (explicitIds.length > 1) return
    const preferred = preferredLegacyId(group.map((item) => item.legacyId))
    if (preferred) exactGroupCanonical.set(normalizedName, preferred)
  })

  const legacyGroups = observations.reduce((groups, observation) => {
    const group = groups.get(observation.legacyId) ?? []
    group.push(observation)
    groups.set(observation.legacyId, group)
    return groups
  }, new Map<string, IdentityObservation[]>())
  const preferredNameByLegacyId = new Map<string, string>()
  legacyGroups.forEach((group, legacyId) => {
    const templatesForId = group.filter((item) => item.source === 'template').sort((a, b) => a.sourceOrder - b.sourceOrder)
    preferredNameByLegacyId.set(legacyId, templatesForId[templatesForId.length - 1]?.normalizedName ?? group[0].normalizedName)
  })

  const resolveObservation = (exercise: { id: string; exerciseId?: string; name: string }) => {
    const explicit = exercise.exerciseId?.trim()
    if (explicit) return explicit
    const normalizedName = normalizeExerciseName(exercise.name)
    const known = knownExerciseIdentities.get(normalizedName)
    if (known) return known.id
    const existing = findLegacyDefinitionByExactName(existingLibrary, exercise.name)
    if (existing) return existing.id
    const knownAlias = knownLegacyNameAliases.get(legacyNameAliasKey(exercise.id, exercise.name))
    if (knownAlias) return knownAlias
    const exactGroup = exactGroups.get(normalizedName) ?? []
    const exactCanonical = exactGroupCanonical.get(normalizedName)
    if (new Set(exactGroup.map((item) => item.legacyId)).size > 1 && exactCanonical) return exactCanonical
    const legacyGroup = legacyGroups.get(exercise.id) ?? []
    if (new Set(legacyGroup.map((item) => item.normalizedName)).size > 1) {
      return preferredNameByLegacyId.get(exercise.id) === normalizedName
        ? exercise.id
        : `${exercise.id}-${deterministicNameSuffix(normalizedName)}`
    }
    return exactCanonical ?? exercise.id
  }

  const migratedTemplates = templates.map((template) => ({
    ...template,
    exercises: template.exercises.map((exercise) => ({ ...exercise, exerciseId: resolveObservation(exercise) })),
  }))
  const migratedWorkouts = workouts.map((workout) => ({
    ...workout,
    exercises: workout.exercises.map((exercise) => ({ ...exercise, exerciseId: resolveObservation(exercise) })),
  }))

  const resolvedObservations = [
    ...migratedTemplates.flatMap((template) => template.exercises.map((exercise, index) => ({
      id: exercise.exerciseId!,
      name: exercise.name,
      equipmentSensitive: exercise.equipmentSensitive,
      source: 'template' as const,
      order: index,
    }))),
    ...migratedWorkouts.flatMap((workout, workoutIndex) => workout.exercises.map((exercise, index) => ({
      id: exercise.exerciseId!,
      name: exercise.name,
      equipmentSensitive: exercise.equipmentSensitive,
      source: 'workout' as const,
      order: workoutIndex * 1000 + index,
    }))),
  ]
  const observationsByCanonical = resolvedObservations.reduce((groups, observation) => {
    const group = groups.get(observation.id) ?? []
    group.push(observation)
    groups.set(observation.id, group)
    return groups
  }, new Map<string, typeof resolvedObservations>())

  let exerciseLibrary = existingLibrary.map((definition) => ({
    ...definition,
    ...(definition.aliases?.length ? { aliases: uniqueNames(definition.aliases) } : { aliases: undefined }),
  }))
  observationsByCanonical.forEach((group, id) => {
    const existingIndex = exerciseLibrary.findIndex((definition) => definition.id === id)
    if (existingIndex >= 0) {
      const existing = exerciseLibrary[existingIndex]
      const aliases = uniqueNames([
        ...(existing.aliases ?? []),
        ...group.map((item) => item.name),
      ]).filter((name) => normalizeExerciseName(name) !== normalizeExerciseName(existing.name))
      exerciseLibrary[existingIndex] = { ...existing, ...(aliases.length ? { aliases } : { aliases: undefined }) }
      return
    }
    const known = group
      .map((item) => knownExerciseIdentities.get(normalizeExerciseName(item.name)))
      .find((identity) => identity?.id === id)
    const templateNames = group.filter((item) => item.source === 'template').sort((a, b) => a.order - b.order)
    const workoutNames = group.filter((item) => item.source === 'workout').sort((a, b) => a.order - b.order)
    const selectedName = known?.name
      ?? templateNames[templateNames.length - 1]?.name
      ?? workoutNames[workoutNames.length - 1]?.name
      ?? id
    const aliases = uniqueNames(group.map((item) => item.name))
      .filter((name) => normalizeExerciseName(name) !== normalizeExerciseName(selectedName))
    exerciseLibrary.push({
      id,
      name: selectedName,
      equipmentSensitive: known?.equipmentSensitive ?? group.some((item) => item.equipmentSensitive === true),
      ...(aliases.length ? { aliases } : {}),
    })
  })

  const referencedIds = new Set(resolvedObservations.map((observation) => observation.id))
  const definedIds = new Set(exerciseLibrary.map((definition) => definition.id))
  const missingDefinition = [...referencedIds].find((id) => !definedIds.has(id))
  if (missingDefinition) throw new Error(`Brak definicji ćwiczenia: ${missingDefinition}`)

  return { templates: migratedTemplates, workouts: migratedWorkouts, exerciseLibrary }
}
