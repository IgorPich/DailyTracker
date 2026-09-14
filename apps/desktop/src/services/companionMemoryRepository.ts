import { validateMemoryState, type MemoryRepository, type MemoryState } from '@greekgod/companion/memory'

export interface MemoryLocalStorage { read(): Promise<string | null>; write(text: string): Promise<void> }
export class LocalCompanionMemoryRepository implements MemoryRepository {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly storage: MemoryLocalStorage
  constructor(storage: MemoryLocalStorage) { this.storage = storage }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation)
    this.queue = next.catch(() => undefined); return next
  }
  private async load() {
    const text = await this.storage.read()
    return validateMemoryState(text === null ? { version: 1, items: [] } : JSON.parse(text))
  }
  read() { return this.serialize(() => this.load()) }
  update(change: (current: MemoryState) => MemoryState | Promise<MemoryState>) {
    return this.serialize(async () => {
      const current = await this.load()
      const next = validateMemoryState(await change(structuredClone(current)))
      // Accepted contents and provenance are immutable; only archiving is permitted.
      for (const item of current.items) {
        const after = next.items.find((entry) => entry.id === item.id)
        if (!after || JSON.stringify({ ...after, status: item.status }) !== JSON.stringify(item)
          || (item.status === 'ARCHIVED' && after.status !== 'ARCHIVED')) throw new Error('Memory provenance/content is immutable')
      }
      if (JSON.stringify(next) !== JSON.stringify(current)) await this.storage.write(JSON.stringify(next))
      return structuredClone(next)
    })
  }
}
