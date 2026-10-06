export const UPDATE_INSTALL_EXIT_FALLBACK_MS = 5_000

export interface CloseRequestEvent {
  preventDefault(): void
}

export interface StagedUpdate {
  install(options: { restartAfterInstall: boolean }): Promise<void>
}

export type CloseFailureStage = 'flush' | 'install' | 'destroy'

export interface CloseLifecycleDependencies {
  beginShutdown(): Promise<void>
  getStagedUpdate(): StagedUpdate | undefined
  destroyWindow(): Promise<void>
  reportFailure(stage: CloseFailureStage, error: unknown): void
  scheduleExitFallback?(callback: () => void, delayMs: number): () => void
}

const defaultScheduleExitFallback = (callback: () => void, delayMs: number) => {
  const timer = window.setTimeout(callback, delayMs)
  return () => window.clearTimeout(timer)
}

export const createCloseLifecycle = (dependencies: CloseLifecycleDependencies) => {
  let closeTask: Promise<void> | undefined
  let destroyTask: Promise<void> | undefined

  const destroyOnce = () => {
    if (!destroyTask) {
      destroyTask = dependencies.destroyWindow().catch((error) => {
        dependencies.reportFailure('destroy', error)
      })
    }
    return destroyTask
  }

  return (event: CloseRequestEvent) => {
    event.preventDefault()
    if (closeTask) return closeTask

    let flushTask: Promise<void>
    try {
      // beginShutdown closes the write gate synchronously before its promise is awaited.
      flushTask = dependencies.beginShutdown()
    } catch (error) {
      flushTask = Promise.reject(error)
    }

    closeTask = (async () => {
      try {
        await flushTask
      } catch (error) {
        dependencies.reportFailure('flush', error)
        await destroyOnce()
        return
      }

      const stagedUpdate = dependencies.getStagedUpdate()
      if (!stagedUpdate) {
        await destroyOnce()
        return
      }

      const scheduleExitFallback = dependencies.scheduleExitFallback ?? defaultScheduleExitFallback
      const cancelFallback = scheduleExitFallback(() => { void destroyOnce() }, UPDATE_INSTALL_EXIT_FALLBACK_MS)
      try {
        // On Windows Tauri exits the process after successfully launching the passive installer.
        await stagedUpdate.install({ restartAfterInstall: true })
      } catch (error) {
        dependencies.reportFailure('install', error)
      } finally {
        cancelFallback()
        await destroyOnce()
      }
    })()

    return closeTask
  }
}
