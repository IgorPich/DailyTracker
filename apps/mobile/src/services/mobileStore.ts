import type { AppData } from '@greekgod/core'
import { invoke } from '@tauri-apps/api/core'

export interface MobileSnapshot {
  data: AppData
  revision: number
  appliedOperations: number
  pendingChanges: number
  deviceId: string
  probe: {
    databasePath: string
    sqliteVersion: string
    schemaVersion: number
    journalMode: string
  }
}

export interface MobileStore {
  initialize(initialData: AppData): Promise<MobileSnapshot>
  load(): Promise<MobileSnapshot>
  save(data: AppData, expectedRevision: number): Promise<MobileSnapshot>
}

export class NativeMobileStore implements MobileStore {
  initialize(initialData: AppData) {
    return invoke<MobileSnapshot>('mobile_storage_initialize', { initialData })
  }

  load() {
    return invoke<MobileSnapshot>('mobile_storage_load')
  }

  save(data: AppData, expectedRevision: number) {
    return invoke<MobileSnapshot>('mobile_storage_replace', { data, expectedRevision })
  }
}
