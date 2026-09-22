import { isDesktopApp } from './fileService'

export interface AiPackImportProgress {
  phase: 'VERIFYING_SOURCE' | 'VERIFYING' | 'COPYING' | 'VERIFYING_STAGING' | 'COMPLETE'
  relativePath?: string
  completedBytes: number
  totalBytes: number
}

export interface AiPackInstallResult {
  packId: string
  packVersion: string
  modelSha256: string
  installedRoot: string
  installedBytes: number
}

export async function chooseAndInstallOfflineAiPack(onProgress: (progress: AiPackImportProgress) => void) {
  if (!isDesktopApp()) throw new Error('Import pakietu AI jest dostępny tylko w aplikacji Desktop.')
  const [{ open }, { invoke }, { listen }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ])
  const sourceRoot = await open({ multiple: false, directory: true, title: 'Wybierz folder GreekGod Offline AI Pack' })
  if (!sourceRoot || Array.isArray(sourceRoot)) return null
  const unlisten = await listen<AiPackImportProgress>('managed-ai-pack-progress', (event) => onProgress(event.payload))
  try {
    return await invoke<AiPackInstallResult>('managed_ai_pack_install', { sourceRoot })
  } finally {
    unlisten()
  }
}

export async function cancelOfflineAiPackImport() {
  if (!isDesktopApp()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('managed_ai_pack_cancel_import')
}
