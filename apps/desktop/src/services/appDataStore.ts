import type { AppDataStore } from '@greekgod/core'
import { DevelopmentShadowAppDataStore } from './nativeStorageBridge'
import {
  DevelopmentAuthoritativeAppDataStore,
  ProductionSafeAuthoritativeAppDataStore,
} from './nativeAuthorityBridge'
import { legacyAppDataStore } from './legacyAppDataStore'
import { tauriNativeStorageBridge } from './tauriNativeStorageBridge'

const nativeShadowRequested = import.meta.env.VITE_NATIVE_SQLITE_SHADOW === '1'
const nativeAuthorityRequested = import.meta.env.VITE_NATIVE_SQLITE_AUTHORITY === '1'
const productionAuthorityRequested = import.meta.env.VITE_NATIVE_SQLITE_PRODUCTION_AUTHORITY === '1'

export const appDataStore: AppDataStore = productionAuthorityRequested
  ? new ProductionSafeAuthoritativeAppDataStore(legacyAppDataStore, tauriNativeStorageBridge)
  : nativeAuthorityRequested
    ? new DevelopmentAuthoritativeAppDataStore(legacyAppDataStore, tauriNativeStorageBridge)
    : nativeShadowRequested
      ? new DevelopmentShadowAppDataStore(legacyAppDataStore, tauriNativeStorageBridge)
      : legacyAppDataStore
