import {
  canonicalExerciseId,
  decimalInputValue,
  exerciseDefinitionFor,
  normalizeDecimalInput,
  type AppData,
  type DailyEntry,
  type TrainingTemplate,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from '@greekgod/core'

export const JOURNAL_NUMERIC_FIELDS = [
  { key: 'weight', integer: false },
  { key: 'waist', integer: false },
  { key: 'calories', integer: true },
  { key: 'protein', integer: true },
  { key: 'carbs', integer: true },
  { key: 'fat', integer: true },
  { key: 'steps', integer: true },
] as const

export type JournalNumericKey = typeof JOURNAL_NUMERIC_FIELDS[number]['key']
export type JournalNumericDraft = Record<JournalNumericKey, string>

export const journalNumericDraft = (entry?: DailyEntry): JournalNumericDraft => Object.fromEntries(
  JOURNAL_NUMERIC_FIELDS.map(({ key }) => [key, decimalInputValue(entry?.[key])]),
) as JournalNumericDraft

export const applyJournalNumericDraft = (
  entry: DailyEntry,
  draft: JournalNumericDraft,
): DailyEntry => {
  const result = { ...entry }
  for (const { key, integer } of JOURNAL_NUMERIC_FIELDS) {
    delete result[key]
    const raw = draft[key].trim()
    if (!raw) continue
    const value = normalizeDecimalInput(raw)
    if (value === undefined || value < 0 || (integer && !Number.isInteger(value))) {
      throw new Error(`Nieprawidłowa wartość pola: ${key}.`)
    }
    result[key] = value
  }
  return result
}

export const isoToday = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const nextTemplate = (data: Pick<AppData, 'templates' | 'workouts'>) => {
  if (!data.templates.length) return undefined
  const latest = [...data.workouts].sort((left, right) => right.date.localeCompare(left.date))[0]
  const index = latest ? data.templates.findIndex((template) => template.id === latest.templateId) : -1
  return data.templates[(index + 1 + data.templates.length) % data.templates.length] ?? data.templates[0]
}

const emptySet = (): WorkoutSet => ({ id: crypto.randomUUID() })

export const exerciseFromTemplate = (
  templateExercise: TrainingTemplate['exercises'][number],
  data: Pick<AppData, 'exerciseLibrary'>,
): WorkoutExercise => ({
  id: templateExercise.id,
  exerciseId: canonicalExerciseId(templateExercise),
  name: templateExercise.name,
  prescription: templateExercise.prescription,
  sets: Array.from({ length: templateExercise.defaultSets }, emptySet),
  equipmentSensitive: exerciseDefinitionFor(data.exerciseLibrary, templateExercise)?.equipmentSensitive
    ?? templateExercise.equipmentSensitive,
})

export const createWorkoutFromTemplate = (
  template: TrainingTemplate,
  data: Pick<AppData, 'exerciseLibrary' | 'settings'>,
  date = isoToday(),
): Workout => ({
  id: crypto.randomUUID(),
  date,
  templateId: template.id,
  templateCode: template.code,
  templateName: template.name,
  gymLocation: data.settings.lastGymLocation,
  exercises: template.exercises.map((exercise) => exerciseFromTemplate(exercise, data)),
})

export const latestWorkout = (workouts: Workout[]) => [...workouts]
  .sort((left, right) => right.date.localeCompare(left.date))[0]

export const activeWorkoutForToday = (workouts: Workout[], date = isoToday()) => [...workouts]
  .reverse()
  .find((workout) => workout.date === date && workout.exercises.some((exercise) =>
    exercise.sets.some((set) => set.weight === undefined || set.reps === undefined)))

export const upsertWorkoutSet = (
  workout: Workout,
  exerciseId: string,
  setId: string,
  values: Pick<WorkoutSet, 'weight' | 'reps'>,
): Workout => ({
  ...workout,
  exercises: workout.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
    ...exercise,
    sets: exercise.sets.map((set) => set.id !== setId ? set : { ...set, ...values }),
  }),
})

export const appendWorkoutSet = (workout: Workout, exerciseId: string): Workout => ({
  ...workout,
  exercises: workout.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
    ...exercise,
    sets: [...exercise.sets, emptySet()],
  }),
})

export const journalDraft = (existing: DailyEntry | undefined, date: string): DailyEntry => ({
  id: existing?.id ?? crypto.randomUUID(),
  ...existing,
  date,
})
