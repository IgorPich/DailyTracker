import type { AppDataStore } from '@greekgod/core'
import { DevelopmentShadowAppDataStore } from './nativeStorageBridge'
import { legacyAppDataStore } from './legacyAppDataStore'
import { tauriNativeStorageBridge } from './tauriNativeStorageBridge'

const nativeShadowRequested = import.meta.env.VITE_NATIVE_SQLITE_SHADOW === '1'

export const appDataStore: AppDataStore = nativeShadowRequested
  ? new DevelopmentShadowAppDataStore(legacyAppDataStore, tauriNativeStorageBridge)
  : legacyAppDataStore
