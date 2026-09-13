import { invoke, isTauri } from '@tauri-apps/api/core'
import { LocalHumanCoachRepository, type HumanCoachLocalStorage } from './humanCoachRepository.ts'

export const humanCoachStorageName = (development: boolean) => development
  ? 'greekgod-human-coach.dev.v1.json'
  : 'greekgod-human-coach.v1.json'

export interface HumanCoachStorageEnvironment {
  native: boolean
  exists(name: string): Promise<boolean>
  readFile(name: string): Promise<string>
  saveContext(name: string, context: unknown): Promise<void>
  browserStorage(): Pick<Storage, 'getItem' | 'setItem'>
  browserLock<T>(name: string, operation: () => Promise<T>): Promise<T>
}

const environment: HumanCoachStorageEnvironment = {
  native: isTauri(),
  async exists(name) {
    const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    return exists(name, { baseDir: BaseDirectory.AppData })
  },
  async readFile(name) {
    const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    return readTextFile(name, { baseDir: BaseDirectory.AppData })
  },
  async saveContext(name, context) {
    if (name !== humanCoachStorageName(true) && name !== humanCoachStorageName(false)) throw new Error('Unexpected HumanCoach file')
    await invoke('human_coach_save', { development: name === humanCoachStorageName(true), context })
  },
  browserStorage: () => localStorage,
  browserLock: (name, operation) => {
    if (!navigator.locks) return Promise.reject(new Error('Local HumanCoach storage requires Web Locks'))
    return navigator.locks.request(name, operation)
  },
}

export const createHumanCoachLocalStorage = (development: boolean, env = environment): HumanCoachLocalStorage => {
  const name = humanCoachStorageName(development)
  return {
    async read() {
      if (!env.native) return env.browserStorage().getItem(name)
      if (!await env.exists(name)) return null
      // Read disk, not plugin cache: corrupt/missing context must never initialize an empty store.
      const envelope = JSON.parse(await env.readFile(name)) as { context?: unknown } | null
      if (!envelope || envelope.context === undefined) throw new Error('HumanCoach file has no context; refusing to overwrite')
      return JSON.stringify(envelope.context)
    },
    async write(text) {
      if (env.native) await env.saveContext(name, JSON.parse(text))
      else env.browserStorage().setItem(name, text)
    },
    // Windows process guard runs before Tauri; this singleton serializes that process's writes.
    // Browser tabs additionally coordinate through Web Locks.
    exclusive: (operation) => env.native ? operation() : env.browserLock(name, operation),
  }
}

// Lazy I/O: importing this module never opens a store or writes data.
export const humanCoachRepository = new LocalHumanCoachRepository(createHumanCoachLocalStorage(import.meta.env?.DEV ?? true))
