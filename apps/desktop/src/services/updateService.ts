import { isTauri } from '@tauri-apps/api/core'
import type { Update } from '@tauri-apps/plugin-updater'
import { appDataStore } from './appDataStore'
import { createCloseLifecycle, type CloseFailureStage } from './closeLifecycle'

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error' | 'unsupported'

export interface UpdateStatus {
  currentVersion: string
  phase: UpdatePhase
  availableVersion?: string
  progress?: number
  message?: string
}

type Listener = (status: UpdateStatus) => void

let status: UpdateStatus = {
  currentVersion: '—',
  phase: isTauri() ? 'idle' : 'unsupported',
}
let downloadedUpdate: Update | undefined
let startupCheck: Promise<void> | undefined
let activeCheck: Promise<void> | undefined
const listeners = new Set<Listener>()

const publish = (next: UpdateStatus) => {
  status = next
  listeners.forEach((listener) => listener(status))
}

const friendlyError = (error: unknown) => {
  console.error('GreekGod update failed.', error)
  return 'Nie udało się sprawdzić lub pobrać aktualizacji. Spróbujemy ponownie przy następnym uruchomieniu.'
}

const performCheck = async () => {
  let currentVersion = status.currentVersion
  let update: Update | null = null
  try {
    const [{ getVersion }, { check }] = await Promise.all([
      import('@tauri-apps/api/app'),
      import('@tauri-apps/plugin-updater'),
    ])
    currentVersion = await getVersion()
    publish({ currentVersion, phase: 'checking' })
    update = await check({ timeout: 15_000 })
    if (!update) {
      publish({ currentVersion, phase: 'up-to-date' })
      return
    }

    publish({ currentVersion, phase: 'downloading', availableVersion: update.version })
    let downloaded = 0
    let total: number | undefined
    await update.download((event) => {
      if (event.event === 'Started') total = event.data.contentLength
      if (event.event === 'Progress') downloaded += event.data.chunkLength
      publish({
        currentVersion,
        phase: 'downloading',
        availableVersion: update?.version,
        progress: total ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined,
      })
    }, { timeout: 10 * 60_000 })

    // Tauri verifies the downloaded bytes against the configured updater public key
    // before download() resolves. Keep this resource alive until the safe close boundary.
    downloadedUpdate = update
    publish({ currentVersion, phase: 'ready', availableVersion: update.version })
  } catch (error) {
    if (update && update !== downloadedUpdate) await update.close().catch(() => undefined)
    publish({ currentVersion, phase: 'error', message: friendlyError(error) })
  }
}

export const subscribeToUpdates = (listener: Listener) => {
  listeners.add(listener)
  listener(status)
  return () => { listeners.delete(listener) }
}

export const getUpdateStatus = () => status

export const checkForUpdates = (manual = false) => {
  if (!isTauri()) return Promise.resolve()
  if (downloadedUpdate || activeCheck) return activeCheck ?? Promise.resolve()
  if (!manual && startupCheck) return startupCheck

  activeCheck = performCheck().finally(() => { activeCheck = undefined })
  if (!manual) startupCheck = activeCheck
  return activeCheck
}

export const registerUpdateCloseHandler = async () => {
  if (!isTauri()) return () => undefined
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const window = getCurrentWindow()
  const reportFailure = (stage: CloseFailureStage, error: unknown) => {
    if (stage === 'install') {
      publish({
        currentVersion: status.currentVersion,
        phase: 'error',
        availableVersion: downloadedUpdate?.version,
        message: 'Aktualizacja nie została zainstalowana. Obecna wersja pozostała bez zmian.',
      })
    }
    console.error(`GreekGod close failed during ${stage}.`, error)
  }
  const handleClose = createCloseLifecycle({
    beginShutdown: () => appDataStore.beginShutdown(),
    getStagedUpdate: () => downloadedUpdate,
    destroyWindow: () => window.destroy(),
    reportFailure,
  })
  return window.onCloseRequested(handleClose)
}
