import { isTauri } from '@tauri-apps/api/core'
import type { AppData } from '../types'
import { createInitialData, CURRENT_DATA_VERSION, normalizeData, STORAGE_KEY } from '../utils/storage'

const DESKTOP_STORE_FILE = 'formlog.store.json'
const DESKTOP_DATA_KEY = 'appData'
const MIGRATION_BACKUP_KEY = 'appData'

let desktopStorePromise: ReturnType<typeof createDesktopStore> | null = null
let saveQueue = Promise.resolve()

async function createDesktopStore() {
  const { load } = await import('@tauri-apps/plugin-store')
  return load(DESKTOP_STORE_FILE, { autoSave: false })
}

const needsExerciseIdentityBackup = (value: unknown) => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as {
    version?: unknown
    exerciseLibrary?: unknown
    templates?: Array<{ exercises?: Array<{ exerciseId?: unknown }> }>
    workouts?: Array<{ exercises?: Array<{ exerciseId?: unknown }> }>
  }
  const missingReference = [...(candidate.templates ?? []), ...(candidate.workouts ?? [])]
    .some((container) => container.exercises?.some((exercise) => typeof exercise.exerciseId !== 'string' || !exercise.exerciseId.trim()))
  return Number(candidate.version ?? 0) < CURRENT_DATA_VERSION
    || !Array.isArray(candidate.exerciseLibrary)
    || missingReference
}

const backupFingerprint = (value: unknown) => {
  const source = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const verifyBackup = (source: unknown, backup: unknown) => {
  if (JSON.stringify(source) !== JSON.stringify(backup)) {
    throw new Error('Nie udało się zweryfikować kopii danych przed migracją.')
  }
}

const ensureDesktopBackup = async (filename: string, value: unknown) => {
  const { load } = await import('@tauri-apps/plugin-store')
  const backupStore = await load(filename, { autoSave: false })
  const existing = await backupStore.get<unknown>(MIGRATION_BACKUP_KEY)
  if (existing === undefined) {
    await backupStore.set(MIGRATION_BACKUP_KEY, value)
    await backupStore.save()
  }
  verifyBackup(value, await backupStore.get<unknown>(MIGRATION_BACKUP_KEY))
}

const ensureDesktopMigrationBackup = async (value: unknown) => {
  if (!needsExerciseIdentityBackup(value)) return
  await ensureDesktopBackup(`formlog.store.pre-exercise-registry-${backupFingerprint(value)}.backup.json`, value)
}

const ensureBrowserMigrationBackup = (raw: string, value: unknown) => {
  if (!needsExerciseIdentityBackup(value)) return
  const backupKey = `${STORAGE_KEY}.pre-exercise-registry-${backupFingerprint(value)}.backup`
  if (localStorage.getItem(backupKey) === null) localStorage.setItem(backupKey, raw)
  if (localStorage.getItem(backupKey) !== raw) {
    throw new Error('Nie udało się zweryfikować kopii danych przed migracją.')
  }
}

const desktopStoreFileExists = async () => {
  const { BaseDirectory, exists } = await import('@tauri-apps/plugin-fs')
  return exists(DESKTOP_STORE_FILE, { baseDir: BaseDirectory.AppData })
}

const getDesktopStore = () => {
  desktopStorePromise ??= createDesktopStore()
  return desktopStorePromise
}

export const storageService = {
  mode: (): 'tauri-store' | 'browser-local-storage' => isTauri() ? 'tauri-store' : 'browser-local-storage',

  async load(): Promise<AppData> {
    try {
      if (isTauri()) {
        const storeFileExisted = await desktopStoreFileExists()
        const store = await getDesktopStore()
        const stored = await store.get<unknown>(DESKTOP_DATA_KEY)
        if (stored === undefined) {
          if (storeFileExisted) throw new Error('Plik danych istnieje, ale nie zawiera klucza appData.')
          return createInitialData()
        }
        await ensureDesktopMigrationBackup(stored)
        return normalizeData(stored)
      }

      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw === null) return createInitialData()
      const stored = JSON.parse(raw) as unknown
      ensureBrowserMigrationBackup(raw, stored)
      return normalizeData(stored)
    } catch (error) {
      console.error('Nie udało się wczytać danych GreekGod.', error)
      throw error
    }
  },

  async backupBeforeImport(data: AppData): Promise<void> {
    const fingerprint = backupFingerprint(data)
    if (isTauri()) {
      await ensureDesktopBackup(`formlog.store.pre-import-${fingerprint}.backup.json`, data)
      return
    }
    const raw = JSON.stringify(data)
    const key = `${STORAGE_KEY}.pre-import-${fingerprint}.backup`
    if (localStorage.getItem(key) === null) localStorage.setItem(key, raw)
    if (localStorage.getItem(key) !== raw) throw new Error('Nie udało się zweryfikować kopii danych przed importem.')
  },

  save(data: AppData): Promise<void> {
    saveQueue = saveQueue.catch(() => undefined).then(async () => {
      if (isTauri()) {
        const store = await getDesktopStore()
        await store.set(DESKTOP_DATA_KEY, data)
        await store.save()
        return
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    })
    return saveQueue
  },
}
