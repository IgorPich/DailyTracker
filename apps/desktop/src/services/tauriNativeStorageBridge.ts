import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AppData } from '@greekgod/core'
import type {
  NativeShadowResponse,
  NativeStorageBridge,
  NativeStorageProbeResponse,
} from './nativeStorageBridge'

const nativeShadowRequested = import.meta.env.VITE_NATIVE_SQLITE_SHADOW === '1'

export class TauriNativeStorageBridge implements NativeStorageBridge {
  async probe(): Promise<NativeStorageProbeResponse> {
    if (!nativeShadowRequested || !isTauri()) return { enabled: false }
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
}

export const tauriNativeStorageBridge = new TauriNativeStorageBridge()
