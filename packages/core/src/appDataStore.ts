import type { AppData } from './types'

export interface AppDataStore {
  load(): Promise<AppData>
  save(data: AppData): Promise<void>
  backupBeforeImport(data: AppData): Promise<void>
  loadIfChanged?(): Promise<AppData | undefined>
}
