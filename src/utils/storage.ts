import { DEFAULT_TEMPLATES } from '../data/templates'
import { saveTextExport } from '../services/fileService'
import type { AppData, DailyEntry, Settings, Workout } from '../types'

export const STORAGE_KEY = 'formlog.data.v1'

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
  version: 2,
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
    version: 2,
    dailyEntries: candidate.dailyEntries as DailyEntry[],
    workouts: candidate.workouts as Workout[],
    templates: Array.isArray(candidate.templates) && candidate.templates.length ? candidate.templates : DEFAULT_TEMPLATES,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(candidate.settings ?? {}),
      trendThresholds: {
        ...DEFAULT_SETTINGS.trendThresholds,
        ...(candidate.settings?.trendThresholds ?? {}),
      },
    },
    coachNotes: candidate.coachNotes && typeof candidate.coachNotes === 'object' ? candidate.coachNotes : {},
  }
}

export const exportJson = (data: AppData) =>
  saveTextExport(JSON.stringify(data, null, 2), `formlog-backup-${new Date().toISOString().slice(0, 10)}.json`, 'Formlog backup', ['json'])

const csvCell = (value: string | number | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`

export const exportCsv = (entries: DailyEntry[]) => {
  const headers = ['data', 'masa_kg', 'kalorie_kcal', 'bialko_g', 'tluszcz_g', 'kroki', 'talia_cm', 'sen', 'regeneracja', 'notatka']
  const rows = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => [entry.date, entry.weight, entry.calories, entry.protein, entry.fat, entry.steps, entry.waist, entry.sleep, entry.recovery, entry.note])
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\n')}`
  return saveTextExport(csv, `formlog-dziennik-${new Date().toISOString().slice(0, 10)}.csv`, 'Formlog CSV', ['csv'])
}
