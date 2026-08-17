import { DEFAULT_TEMPLATES } from '../data/templates'
import type { AppData, DailyEntry, Settings, Workout } from '../types'

export const STORAGE_KEY = 'formlog.data.v1'

export const DEFAULT_SETTINGS: Settings = {
  phase: 'Maintenance',
  calorieTarget: 2800,
  proteinTarget: 160,
}

export const createInitialData = (): AppData => ({
  version: 1,
  dailyEntries: [],
  workouts: [],
  templates: DEFAULT_TEMPLATES,
  settings: DEFAULT_SETTINGS,
})

export const loadData = (): AppData => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createInitialData()
    return normalizeData(JSON.parse(raw))
  } catch {
    return createInitialData()
  }
}

export const saveData = (data: AppData) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data))

export const normalizeData = (value: unknown): AppData => {
  if (!value || typeof value !== 'object') throw new Error('Nieprawidłowy format pliku.')
  const candidate = value as Partial<AppData>
  if (!Array.isArray(candidate.dailyEntries) || !Array.isArray(candidate.workouts)) {
    throw new Error('Plik nie zawiera wymaganych danych.')
  }
  return {
    version: 1,
    dailyEntries: candidate.dailyEntries as DailyEntry[],
    workouts: candidate.workouts as Workout[],
    templates: Array.isArray(candidate.templates) && candidate.templates.length ? candidate.templates : DEFAULT_TEMPLATES,
    settings: { ...DEFAULT_SETTINGS, ...(candidate.settings ?? {}) },
  }
}

export const downloadFile = (contents: string, filename: string, mime: string) => {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export const exportJson = (data: AppData) =>
  downloadFile(JSON.stringify(data, null, 2), `formlog-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json')

const csvCell = (value: string | number | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`

export const exportCsv = (entries: DailyEntry[]) => {
  const headers = ['data', 'masa_kg', 'kalorie_kcal', 'bialko_g', 'tluszcz_g', 'kroki', 'talia_cm', 'sen', 'regeneracja', 'notatka']
  const rows = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => [entry.date, entry.weight, entry.calories, entry.protein, entry.fat, entry.steps, entry.waist, entry.sleep, entry.recovery, entry.note])
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\n')}`
  downloadFile(csv, `formlog-dziennik-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8')
}
