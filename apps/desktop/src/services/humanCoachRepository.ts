import { emptyHumanCoachContext, validateHumanCoachContext, type HumanCoachContext, type HumanCoachRepository } from '@greekgod/human-coach'

export interface HumanCoachLocalStorage {
  read(): Promise<string | null>
  write(text: string): Promise<void>
  exclusive<T>(operation: () => Promise<T>): Promise<T>
}

export class LocalHumanCoachRepository implements HumanCoachRepository {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly storage: HumanCoachLocalStorage
  constructor(storage: HumanCoachLocalStorage) { this.storage = storage }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => this.storage.exclusive(operation))
    this.queue = result.catch(() => undefined)
    return result
  }
  private async load(): Promise<HumanCoachContext> {
    const text = await this.storage.read()
    const context: unknown = text === null ? emptyHumanCoachContext() : JSON.parse(text)
    validateHumanCoachContext(context)
    return structuredClone(context)
  }
  read() { return this.serialize(() => this.load()) }
  update(change: (current: HumanCoachContext) => HumanCoachContext) {
    return this.serialize(async () => {
      const current = await this.load()
      const next = change(structuredClone(current))
      validateHumanCoachContext(next)
      // Defense in depth: an adapter caller cannot overwrite or remove original source notes.
      for (const note of current.items.filter((item) => item.kind === 'NOTE')) {
        const after = next.items.find((item) => item.id === note.id)
        if (!after || after.kind !== 'NOTE' || after.text !== note.text || after.createdAt !== note.createdAt || JSON.stringify(after.provenance) !== JSON.stringify(note.provenance)) {
          throw new Error('CoachNote source content is immutable')
        }
      }
      const text = JSON.stringify(next)
      await this.storage.write(text)
      return JSON.parse(text) as HumanCoachContext
    })
  }
}
