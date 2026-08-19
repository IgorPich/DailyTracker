import { DEFAULT_TEMPLATES } from '../data/templates'
import { saveTextExport } from '../services/fileService'
import type { AppData, DailyEntry, Settings, Workout } from '../types'
import { upgradeBuiltInTemplates } from './dataMigration'

export const STORAGE_KEY = 'formlog.data.v1'
export const CURRENT_DATA_VERSION = 3

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

export const createInitialData = (): AppData => ({
  version: CURRENT_DATA_VERSION,
  dailyEntries: [],
  workouts: [],
  templates: DEFAULT_TEMPLATES,
  settings: DEFAULT_SETTINGS,
  coachNotes: {},
})

export const normalizeData = (value: unknown): AppData => {
  if (!value || typeof value !== 'object') throw new Error('Nieprawidłowy format pliku.')
  const candidate = value as Partial<AppData>
  if (!Array.isArray(candidate.dailyEntries) || !Array.isArray(candidate.workouts)) {
    throw new Error('Plik nie zawiera wymaganych danych.')
  }
  return {
    version: CURRENT_DATA_VERSION,
    dailyEntries: candidate.dailyEntries as DailyEntry[],
    workouts: candidate.workouts as Workout[],
    templates: Number(candidate.version ?? 0) < CURRENT_DATA_VERSION
      ? upgradeBuiltInTemplates(Array.isArray(candidate.templates) && candidate.templates.length ? candidate.templates : DEFAULT_TEMPLATES, DEFAULT_TEMPLATES)
      : (Array.isArray(candidate.templates) && candidate.templates.length ? candidate.templates : DEFAULT_TEMPLATES),
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
