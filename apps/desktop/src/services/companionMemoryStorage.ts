import { invoke, isTauri } from '@tauri-apps/api/core'
import { LocalCompanionMemoryRepository, type MemoryLocalStorage } from './companionMemoryRepository.ts'

export const companionMemoryFile = (development: boolean) => development ? 'greekgod-companion-memory.dev.v1.json' : 'greekgod-companion-memory.v1.json'
export interface MemoryStorageEnvironment {
  native: boolean
  exists(name: string): Promise<boolean>
  readFile(name: string): Promise<string>
  save(development: boolean, memory: unknown): Promise<void>
}
const environment: MemoryStorageEnvironment = {
  native: isTauri(),
  async exists(name) {
    const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    return exists(name, { baseDir: BaseDirectory.AppData })
  },
  async readFile(name) {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    return readTextFile(name, { baseDir: BaseDirectory.AppData })
  },
  save: (development, memory) => invoke('companion_memory_save', { development, memory }),
}
export const createCompanionMemoryStorage = (development: boolean, env = environment): MemoryLocalStorage => {
  const name = companionMemoryFile(development)
  return {
    async read() {
      if (!env.native) return null // browser preview has no persistent memory
      if (!await env.exists(name)) return null
      const envelope = JSON.parse(await env.readFile(name))
      if (!envelope || Object.keys(envelope).length !== 1 || !('memory' in envelope)) throw new Error('Invalid Companion memory envelope')
      return JSON.stringify(envelope.memory)
    },
    async write(text) {
      if (!env.native) throw new Error('Pamięć trwała wymaga aplikacji Desktop')
      await env.save(development, JSON.parse(text))
    },
  }
}
export const supportsCompanionMemoryPersistence = environment.native
// Lazy singleton: the existing Desktop process guard + this repository queue serialize writers.
export const companionMemoryRepository = new LocalCompanionMemoryRepository(createCompanionMemoryStorage(import.meta.env?.DEV ?? true))
