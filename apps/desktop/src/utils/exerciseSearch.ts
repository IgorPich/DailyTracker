import type { ExerciseDefinition, TrainingTemplate, Workout } from '@greekgod/core'

// Discovery only. Never use normalized text or similarity as an identity resolver.
export const normalizeSearchText = (value: string) => value.toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').trim()

const distance = (a: string, b: string) => {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]))
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1)
  }
  return matrix[a.length][b.length]
}

export interface ExerciseSearchOption { definition: ExerciseDefinition; label: string; detail: string }
export const selectExerciseResult = (library: readonly ExerciseDefinition[], option: ExerciseSearchOption, onSelect: (definition: ExerciseDefinition) => void) => {
  const matches = library.filter((item) => item.id === option.definition.id)
  if (matches.length !== 1 || !option.definition.id.trim() || option.definition.id !== option.definition.id.trim()) return false
  onSelect(matches[0])
  return true
}

export const exerciseSearchOptions = (
  library: readonly ExerciseDefinition[],
  templates: readonly TrainingTemplate[] = [],
  workouts: readonly Workout[] = [],
): ExerciseSearchOption[] => {
  const counts = new Map<string, number>()
  library.forEach((item) => counts.set(item.id, (counts.get(item.id) ?? 0) + 1))
  const definitions = library.filter((item) => item.id.trim() && item.id === item.id.trim() && counts.get(item.id) === 1)
  const active = new Set(templates.flatMap((item) => item.exercises.map((exercise) => exercise.exerciseId)))
  const latest = new Map<string, string>()
  workouts.forEach((workout) => workout.exercises.forEach((exercise) => {
    if (!exercise.exerciseId || exercise.skipped || !exercise.sets.some((set) => Number.isFinite(set.weight) && Number.isFinite(set.reps))) return
    if ((latest.get(exercise.exerciseId) ?? '') < workout.date) latest.set(exercise.exerciseId, workout.date)
  }))
  const nameCounts = new Map<string, number>()
  definitions.forEach((item) => { const name = normalizeSearchText(item.name); nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1) })
  const nameIndexes = new Map<string, number>()
  const options = definitions.map((definition, order) => {
    const name = normalizeSearchText(definition.name)
    const variant = (nameIndexes.get(name) ?? 0) + 1
    nameIndexes.set(name, variant)
    const date = latest.get(definition.id)
    return {
      definition, order, date, active: active.has(definition.id),
      label: (nameCounts.get(name) ?? 0) > 1 ? `${definition.name} · wariant ${variant}` : definition.name,
      detail: [date ? `Ostatnio: ${date}` : '', active.has(definition.id) ? 'W szablonie' : '', definition.equipmentSensitive ? 'Zależne od sprzętu' : ''].filter(Boolean).join(' · '),
    }
  })
  return options.sort((a, b) => Number(Boolean(b.date)) - Number(Boolean(a.date)) || (b.date ?? '').localeCompare(a.date ?? '') || Number(b.active) - Number(a.active) || a.order - b.order)
}

export const searchExercises = (options: readonly ExerciseSearchOption[], text: string) => {
  const tokens = normalizeSearchText(text).slice(0, 160).split(/\s+/).filter(Boolean)
  if (!tokens.length) return [...options]
  return options.map((option, order) => {
    const name = normalizeSearchText(option.definition.name)
    const words = name.split(/[^a-z0-9]+/).filter(Boolean)
    const score = tokens.reduce((sum, token) => {
      if (name.includes(token)) return sum
      const best = Math.min(...words.map((word) => distance(token, word)))
      return sum + (token.length >= 4 && best <= (token.length >= 8 ? 2 : 1) ? best : Infinity)
    }, 0)
    return { option, score, order }
  }).filter((item) => Number.isFinite(item.score)).sort((a, b) => a.score - b.score || a.order - b.order).map((item) => item.option)
}

export const newExerciseConfirmation = (library: readonly ExerciseDefinition[], name: string) => {
  const similar = searchExercises(exerciseSearchOptions(library), name).slice(0, 5)
  return `Utworzyć nowe ćwiczenie „${name.trim()}” z osobną historią?${similar.length ? `\nPodobne istniejące ćwiczenia:\n${similar.map((item) => item.label).join('\n')}\nJeśli chodzi o istniejące ćwiczenie, anuluj i wybierz je z wyszukiwarki.` : ''}`
}
