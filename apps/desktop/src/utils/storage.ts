import { DEFAULT_TEMPLATES } from '../data/templates'
import { saveTextExport } from '../services/fileService'
import type { AppData, DailyEntry, ExerciseDefinition, Settings, Workout } from '../types'
import { migrateLegacyExerciseIdentity } from './dataMigration'

export const STORAGE_KEY = 'formlog.data.v1'
export const CURRENT_DATA_VERSION = 4

export const DEFAULT_SETTINGS: Settings = {
  phase: 'Maintenance',
  calorieTarget: 2800,
  proteinTarget: 160,
  trendThresholds: {
    lossBelow: -0.15,
    stableUpper: 0.05,
    slowGainUpper: 0.2,
  },
}

const exerciseLibraryFromCanonicalTemplates = (): ExerciseDefinition[] => DEFAULT_TEMPLATES
  .flatMap((template) => template.exercises)
  .reduce<ExerciseDefinition[]>((definitions, exercise) => {
    const exerciseId = exercise.exerciseId
    if (!exerciseId) throw new Error(`Brak ExerciseDefinitionId w domyślnym szablonie: ${exercise.id}`)
    if (definitions.some((definition) => definition.id === exerciseId)) return definitions
    return [...definitions, {
      id: exerciseId,
      name: exercise.name,
      equipmentSensitive: Boolean(exercise.equipmentSensitive),
    }]
  }, [])

export const createInitialData = (): AppData => ({
    version: CURRENT_DATA_VERSION,
    dailyEntries: [],
    workouts: [],
    templates: structuredClone(DEFAULT_TEMPLATES),
    exerciseLibrary: exerciseLibraryFromCanonicalTemplates(),
    settings: DEFAULT_SETTINGS,
    coachNotes: {},
})

export const normalizeData = (value: unknown): AppData => {
  if (!value || typeof value !== 'object') throw new Error('Nieprawidłowy format pliku.')
  const candidate = value as Partial<AppData>
  if (!Array.isArray(candidate.dailyEntries) || !Array.isArray(candidate.workouts)) {
    throw new Error('Plik nie zawiera wymaganych danych.')
  }
  const sourceVersion = Number(candidate.version ?? 0)
  if (!Number.isFinite(sourceVersion) || sourceVersion > CURRENT_DATA_VERSION) {
    throw new Error('Plik pochodzi z nowszej, nieobsługiwanej wersji GreekGod.')
  }
  if (!Array.isArray(candidate.templates) || !candidate.templates.length) {
    throw new Error('Plik nie zawiera zapisanych szablonów treningowych.')
  }
  const templates = candidate.templates
  const workouts = candidate.workouts as Workout[]
  const exerciseLibrary = Array.isArray(candidate.exerciseLibrary) ? candidate.exerciseLibrary : []
  const identity = sourceVersion < CURRENT_DATA_VERSION
    ? migrateLegacyExerciseIdentity(templates, workouts, exerciseLibrary)
    : { templates, workouts, exerciseLibrary }
  return {
    version: CURRENT_DATA_VERSION,
    dailyEntries: candidate.dailyEntries as DailyEntry[],
    workouts: identity.workouts,
    templates: identity.templates,
    exerciseLibrary: identity.exerciseLibrary,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(candidate.settings ?? {}),
      trendThresholds: {
        ...DEFAULT_SETTINGS.trendThresholds,
        ...(candidate.settings?.trendThresholds ?? {}),
      },
      gymLocations: Array.isArray(candidate.settings?.gymLocations)
        ? candidate.settings.gymLocations.filter((location): location is string => typeof location === 'string' && Boolean(location.trim()))
        : undefined,
      lastGymLocation: typeof candidate.settings?.lastGymLocation === 'string' && candidate.settings.lastGymLocation.trim()
        ? candidate.settings.lastGymLocation
        : undefined,
    },
    coachNotes: candidate.coachNotes && typeof candidate.coachNotes === 'object' ? candidate.coachNotes : {},
  }
}

export const exportJson = (data: AppData) =>
  saveTextExport(JSON.stringify(data, null, 2), `greekgod-kopia-${new Date().toISOString().slice(0, 10)}.json`, 'Kopia zapasowa GreekGod', ['json'])

const csvCell = (value: string | number | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`

export const exportCsv = (entries: DailyEntry[]) => {
  const headers = ['data', 'masa_kg', 'kalorie_kcal', 'bialko_g', 'tluszcz_g', 'weglowodany_g', 'kroki', 'talia_cm', 'notatka']
  const rows = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => [entry.date, entry.weight, entry.calories, entry.protein, entry.fat, entry.carbs, entry.steps, entry.waist, entry.note])
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\n')}`
  return saveTextExport(csv, `greekgod-dziennik-${new Date().toISOString().slice(0, 10)}.csv`, 'GreekGod CSV', ['csv'])
}
