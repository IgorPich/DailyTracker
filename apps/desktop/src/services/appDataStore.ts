import type { AppDataStore } from '@greekgod/core'
import { DevelopmentShadowAppDataStore } from './nativeStorageBridge'
import {
  DevelopmentAuthoritativeAppDataStore,
  ProductionSafeAuthoritativeAppDataStore,
} from './nativeAuthorityBridge'
import { legacyAppDataStore } from './legacyAppDataStore'
import { tauriNativeStorageBridge } from './tauriNativeStorageBridge'

export interface FlushableAppDataStore extends AppDataStore {
  flush(): Promise<void>
}

class TrackedAppDataStore implements FlushableAppDataStore {
  private readonly writes = new Set<Promise<void>>()
  private lastWriteError: unknown

  constructor(private readonly delegate: AppDataStore) {}

  private track(operation: Promise<void>) {
    this.writes.add(operation)
    void operation.then(
      () => { this.lastWriteError = undefined },
      (error) => { this.lastWriteError = error },
    ).finally(() => this.writes.delete(operation))
    return operation
  }

  load() {
    return this.delegate.load()
  }

  save(data: Parameters<AppDataStore['save']>[0]) {
    return this.track(this.delegate.save(data))
  }

  backupBeforeImport(data: Parameters<AppDataStore['backupBeforeImport']>[0]) {
    return this.track(this.delegate.backupBeforeImport(data))
  }

  async loadIfChanged() {
    return this.delegate.loadIfChanged?.()
  }

  async flush() {
    while (this.writes.size) {
      await Promise.allSettled([...this.writes])
    }
    if (this.lastWriteError) throw this.lastWriteError
  }
}

const nativeShadowRequested = import.meta.env.VITE_NATIVE_SQLITE_SHADOW === '1'
const nativeAuthorityRequested = import.meta.env.VITE_NATIVE_SQLITE_AUTHORITY === '1'
const productionAuthorityRequested = import.meta.env.VITE_NATIVE_SQLITE_PRODUCTION_AUTHORITY === '1'

const selectedAppDataStore: AppDataStore = productionAuthorityRequested
  ? new ProductionSafeAuthoritativeAppDataStore(legacyAppDataStore, tauriNativeStorageBridge)
  : nativeAuthorityRequested
    ? new DevelopmentAuthoritativeAppDataStore(legacyAppDataStore, tauriNativeStorageBridge)
    : nativeShadowRequested
      ? new DevelopmentShadowAppDataStore(legacyAppDataStore, tauriNativeStorageBridge)
      : legacyAppDataStore

export const appDataStore: FlushableAppDataStore = new TrackedAppDataStore(selectedAppDataStore)
