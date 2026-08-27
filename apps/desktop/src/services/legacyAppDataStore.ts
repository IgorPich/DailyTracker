import { isTauri } from '@tauri-apps/api/core'
import type { AppDataStore } from '@greekgod/core'
import type { AppData } from '../types'
import { createInitialData, CURRENT_DATA_VERSION, normalizeData, STORAGE_KEY } from '../utils/storage'

const DESKTOP_STORE_FILE = 'formlog.store.json'
const DESKTOP_DATA_KEY = 'appData'
const MIGRATION_BACKUP_KEY = 'appData'

export interface LegacyKeyValueStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  save(): Promise<void>
}

export interface LegacyBrowserStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface LegacyAppDataStoreEnvironment {
  isTauri(): boolean
  loadDesktopStore(filename: string): Promise<LegacyKeyValueStore>
  desktopStoreFileExists(filename: string): Promise<boolean>
  browserStorage(): LegacyBrowserStorage
}

const defaultEnvironment: LegacyAppDataStoreEnvironment = {
  isTauri,
  async loadDesktopStore(filename) {
    const { load } = await import('@tauri-apps/plugin-store')
    return load(filename, { autoSave: false })
  },
  async desktopStoreFileExists(filename) {
    const { BaseDirectory, exists } = await import('@tauri-apps/plugin-fs')
    return exists(filename, { baseDir: BaseDirectory.AppData })
  },
  browserStorage: () => localStorage,
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

export class LegacyAppDataStore implements AppDataStore {
  private desktopStorePromise: Promise<LegacyKeyValueStore> | null = null
  private saveQueue = Promise.resolve()
  private readonly environment: LegacyAppDataStoreEnvironment

  constructor(environment: LegacyAppDataStoreEnvironment = defaultEnvironment) {
    this.environment = environment
  }

  mode(): 'tauri-store' | 'browser-local-storage' {
    return this.environment.isTauri() ? 'tauri-store' : 'browser-local-storage'
  }

  private getDesktopStore() {
    this.desktopStorePromise ??= this.environment.loadDesktopStore(DESKTOP_STORE_FILE)
    return this.desktopStorePromise
  }

  private async ensureDesktopBackup(filename: string, value: unknown) {
    const backupStore = await this.environment.loadDesktopStore(filename)
    const existing = await backupStore.get<unknown>(MIGRATION_BACKUP_KEY)
    if (existing === undefined) {
      await backupStore.set(MIGRATION_BACKUP_KEY, value)
      await backupStore.save()
    }
    verifyBackup(value, await backupStore.get<unknown>(MIGRATION_BACKUP_KEY))
  }

  private async ensureDesktopMigrationBackup(value: unknown) {
    if (!needsExerciseIdentityBackup(value)) return
    await this.ensureDesktopBackup(`formlog.store.pre-exercise-registry-${backupFingerprint(value)}.backup.json`, value)
  }

  private ensureBrowserMigrationBackup(raw: string, value: unknown) {
    if (!needsExerciseIdentityBackup(value)) return
    const browserStorage = this.environment.browserStorage()
    const backupKey = `${STORAGE_KEY}.pre-exercise-registry-${backupFingerprint(value)}.backup`
    if (browserStorage.getItem(backupKey) === null) browserStorage.setItem(backupKey, raw)
    if (browserStorage.getItem(backupKey) !== raw) {
      throw new Error('Nie udało się zweryfikować kopii danych przed migracją.')
    }
  }

  async load(): Promise<AppData> {
    try {
      if (this.environment.isTauri()) {
        const storeFileExisted = await this.environment.desktopStoreFileExists(DESKTOP_STORE_FILE)
        const store = await this.getDesktopStore()
        const stored = await store.get<unknown>(DESKTOP_DATA_KEY)
        if (stored === undefined) {
          if (storeFileExisted) throw new Error('Plik danych istnieje, ale nie zawiera klucza appData.')
          return createInitialData()
        }
        await this.ensureDesktopMigrationBackup(stored)
        return normalizeData(stored)
      }

      const browserStorage = this.environment.browserStorage()
      const raw = browserStorage.getItem(STORAGE_KEY)
      if (raw === null) return createInitialData()
      const stored = JSON.parse(raw) as unknown
      this.ensureBrowserMigrationBackup(raw, stored)
      return normalizeData(stored)
    } catch (error) {
      console.error('Nie udało się wczytać danych GreekGod.', error)
      throw error
    }
  }

  async loadForAuthorityMigration(): Promise<AppData> {
    if (this.environment.isTauri()) {
      const storeFileExisted = await this.environment.desktopStoreFileExists(DESKTOP_STORE_FILE)
      const store = await this.getDesktopStore()
      const stored = await store.get<unknown>(DESKTOP_DATA_KEY)
      if (stored === undefined) {
        if (storeFileExisted) throw new Error('Plik danych istnieje, ale nie zawiera klucza appData.')
        return createInitialData()
      }
      await this.ensureDesktopBackup(
        `formlog.store.pre-v3-authority-${backupFingerprint(stored)}.backup.json`,
        stored,
      )
      return normalizeData(stored)
    }

    const browserStorage = this.environment.browserStorage()
    const raw = browserStorage.getItem(STORAGE_KEY)
    if (raw === null) return createInitialData()
    const backupKey = `${STORAGE_KEY}.pre-v3-authority-${backupFingerprint(JSON.parse(raw))}.backup`
    if (browserStorage.getItem(backupKey) === null) browserStorage.setItem(backupKey, raw)
    if (browserStorage.getItem(backupKey) !== raw) {
      throw new Error('Nie udało się zweryfikować kopii danych przed migracją do SQLite.')
    }
    return normalizeData(JSON.parse(raw) as unknown)
  }

  async backupBeforeImport(data: AppData): Promise<void> {
    const fingerprint = backupFingerprint(data)
    if (this.environment.isTauri()) {
      await this.ensureDesktopBackup(`formlog.store.pre-import-${fingerprint}.backup.json`, data)
      return
    }
    const browserStorage = this.environment.browserStorage()
    const raw = JSON.stringify(data)
    const key = `${STORAGE_KEY}.pre-import-${fingerprint}.backup`
    if (browserStorage.getItem(key) === null) browserStorage.setItem(key, raw)
    if (browserStorage.getItem(key) !== raw) {
      throw new Error('Nie udało się zweryfikować kopii danych przed importem.')
    }
  }

  save(data: AppData): Promise<void> {
    this.saveQueue = this.saveQueue.catch(() => undefined).then(async () => {
      if (this.environment.isTauri()) {
        const store = await this.getDesktopStore()
        await store.set(DESKTOP_DATA_KEY, data)
        await store.save()
        return
      }
      this.environment.browserStorage().setItem(STORAGE_KEY, JSON.stringify(data))
    })
    return this.saveQueue
  }
}

export const legacyAppDataStore = new LegacyAppDataStore()
