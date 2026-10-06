import type { AppDataStore } from '@greekgod/core'

export interface FlushableAppDataStore extends AppDataStore {
  beginShutdown(): Promise<void>
  flush(): Promise<void>
}

export class TrackedAppDataStore implements FlushableAppDataStore {
  private readonly delegate: AppDataStore
  private readonly writes = new Set<Promise<void>>()
  private lastWriteError: unknown
  private acceptingWrites = true

  constructor(delegate: AppDataStore) {
    this.delegate = delegate
  }

  private track(operation: Promise<void>) {
    this.writes.add(operation)
    void operation.then(
      () => { this.lastWriteError = undefined },
      (error) => { this.lastWriteError = error },
    ).finally(() => this.writes.delete(operation))
    return operation
  }

  private rejectAfterShutdown() {
    return Promise.reject(new Error('GreekGod is closing and no longer accepts data writes.'))
  }

  load() {
    return this.delegate.load()
  }

  save(data: Parameters<AppDataStore['save']>[0]) {
    if (!this.acceptingWrites) return this.rejectAfterShutdown()
    return this.track(this.delegate.save(data))
  }

  backupBeforeImport(data: Parameters<AppDataStore['backupBeforeImport']>[0]) {
    if (!this.acceptingWrites) return this.rejectAfterShutdown()
    return this.track(this.delegate.backupBeforeImport(data))
  }

  async loadIfChanged() {
    return this.delegate.loadIfChanged?.()
  }

  beginShutdown() {
    this.acceptingWrites = false
    return this.flush()
  }

  async flush() {
    while (this.writes.size) {
      await Promise.allSettled([...this.writes])
    }
    if (this.lastWriteError) throw this.lastWriteError
  }
}
