import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AppData } from '@greekgod/core'
import type {
  NativeShadowResponse,
  NativeStorageBridge,
  NativeStorageProbeResponse,
} from './nativeStorageBridge'
import type {
  NativeAuthorityBridge,
  NativeAuthorityResponse,
  NativeAuthorityStatusResponse,
} from './nativeAuthorityBridge'

const nativeShadowRequested = import.meta.env.VITE_NATIVE_SQLITE_SHADOW === '1'
const nativeAuthorityRequested = import.meta.env.VITE_NATIVE_SQLITE_AUTHORITY === '1'
const productionAuthorityRequested = import.meta.env.VITE_NATIVE_SQLITE_PRODUCTION_AUTHORITY === '1'
const anyAuthorityRequested = nativeAuthorityRequested || productionAuthorityRequested
const nativeRuntimeRequested = nativeShadowRequested || anyAuthorityRequested

export class TauriNativeStorageBridge implements NativeStorageBridge, NativeAuthorityBridge {
  async probe(): Promise<NativeStorageProbeResponse> {
    if (!nativeRuntimeRequested || !isTauri()) return { enabled: false }
    return invoke<NativeStorageProbeResponse>('native_storage_probe')
  }

  async replaceShadow(data: AppData): Promise<NativeShadowResponse> {
    if (!nativeShadowRequested || !isTauri()) return { enabled: false }
    return invoke<NativeShadowResponse>('native_shadow_replace', { data })
  }

  async loadShadow(): Promise<NativeShadowResponse> {
    if (!nativeShadowRequested || !isTauri()) return { enabled: false }
    return invoke<NativeShadowResponse>('native_shadow_load')
  }

  async backupShadowBeforeImport(data: AppData): Promise<NativeShadowResponse> {
    if (!nativeShadowRequested || !isTauri()) return { enabled: false }
    return invoke<NativeShadowResponse>('native_shadow_backup_before_import', { data })
  }

  async authorityStatus(): Promise<NativeAuthorityStatusResponse> {
    if (!anyAuthorityRequested || !isTauri()) return { enabled: false }
    return invoke<NativeAuthorityStatusResponse>('native_authority_status')
  }

  async bootstrapAuthority(data: AppData): Promise<NativeAuthorityResponse> {
    if (!anyAuthorityRequested || !isTauri()) return { enabled: false }
    return invoke<NativeAuthorityResponse>('native_authority_bootstrap', { data })
  }

  async loadAuthority(): Promise<NativeAuthorityResponse> {
    if (!anyAuthorityRequested || !isTauri()) return { enabled: false }
    return invoke<NativeAuthorityResponse>('native_authority_load')
  }

  async replaceAuthority(data: AppData, expectedRevision: number): Promise<NativeAuthorityResponse> {
    if (!anyAuthorityRequested || !isTauri()) return { enabled: false }
    return invoke<NativeAuthorityResponse>('native_authority_replace', { data, expectedRevision })
  }

  async backupAuthorityBeforeImport(data: AppData): Promise<NativeAuthorityResponse> {
    if (!anyAuthorityRequested || !isTauri()) return { enabled: false }
    return invoke<NativeAuthorityResponse>('native_authority_backup_before_import', { data })
  }
}

export const tauriNativeStorageBridge = new TauriNativeStorageBridge()
