import { deepStrictEqual, equal, match, rejects, strictEqual } from 'node:assert/strict'
import test from 'node:test'
import { LegacyAppDataStore } from '../../src/services/legacyAppDataStore.ts'
import type {
  LegacyAppDataStoreEnvironment,
  LegacyBrowserStorage,
  LegacyKeyValueStore,
} from '../../src/services/legacyAppDataStore.ts'
import { createInitialData, STORAGE_KEY } from '../../src/utils/storage.ts'
import { fullAppDataFixture } from '../fixtures/full-app-data.fixture.ts'
import { registerAppDataStoreContract } from './appDataStore.contract.ts'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

class MemoryBrowserStorage implements LegacyBrowserStorage {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

class MemoryKeyValueStore implements LegacyKeyValueStore {
  readonly values = new Map<string, unknown>()
  saveCount = 0
  failNextSave = false

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key)
    return value === undefined ? undefined : clone(value) as T
  }

  async set(key: string, value: unknown) {
    this.values.set(key, clone(value))
  }

  async save() {
    this.saveCount += 1
    if (this.failNextSave) {
      this.failNextSave = false
      throw new Error('Synthetic save failure')
    }
  }
}

const browserEnvironment = (storage: MemoryBrowserStorage): LegacyAppDataStoreEnvironment => ({
  isTauri: () => false,
  loadDesktopStore: async () => { throw new Error('Desktop Store must not be used') },
  desktopStoreFileExists: async () => false,
  browserStorage: () => storage,
})

registerAppDataStoreContract('Legacy browser adapter', async () => {
  const storage = new MemoryBrowserStorage()
  const createStore = () => new LegacyAppDataStore(browserEnvironment(storage))
  return {
    store: createStore(),
    reopen: async () => createStore(),
    cleanup: async () => storage.values.clear(),
    expectedInitialData: createInitialData(),
  }
})

const desktopEnvironment = (options: {
  fileExists: boolean
  stores?: Map<string, MemoryKeyValueStore>
  calls?: string[]
}): LegacyAppDataStoreEnvironment => {
  const stores = options.stores ?? new Map<string, MemoryKeyValueStore>()
  const calls = options.calls ?? []
  return {
    isTauri: () => true,
    desktopStoreFileExists: async (filename) => {
      calls.push(`exists:${filename}`)
      return options.fileExists
    },
    loadDesktopStore: async (filename) => {
      calls.push(`load:${filename}`)
      let store = stores.get(filename)
      if (!store) {
        store = new MemoryKeyValueStore()
        stores.set(filename, store)
      }
      return store
    },
    browserStorage: () => { throw new Error('Browser storage must not be used') },
  }
}

registerAppDataStoreContract('Legacy Tauri adapter', async () => {
  const stores = new Map<string, MemoryKeyValueStore>()
  const createStore = () => new LegacyAppDataStore(desktopEnvironment({ fileExists: false, stores }))
  return {
    store: createStore(),
    reopen: async () => createStore(),
    cleanup: async () => stores.clear(),
    expectedInitialData: createInitialData(),
  }
})

test('Legacy desktop adapter checks file existence before loading the exact main Store', async () => {
  const calls: string[] = []
  const store = new LegacyAppDataStore(desktopEnvironment({ fileExists: false, calls }))

  deepStrictEqual(await store.load(), createInitialData())
  deepStrictEqual(calls.slice(0, 2), ['exists:formlog.store.json', 'load:formlog.store.json'])
})

test('Legacy desktop adapter rejects an existing Store without appData and does not write it', async () => {
  const stores = new Map<string, MemoryKeyValueStore>()
  const mainStore = new MemoryKeyValueStore()
  stores.set('formlog.store.json', mainStore)
  const store = new LegacyAppDataStore(desktopEnvironment({ fileExists: true, stores }))

  await rejects(store.load(), /nie zawiera klucza appData/)
  equal(mainStore.saveCount, 0)
  equal(mainStore.values.size, 0)
})

test('Legacy desktop adapter backs up raw pre-v4 data before normalization without saving main Store', async () => {
  const stores = new Map<string, MemoryKeyValueStore>()
  const mainStore = new MemoryKeyValueStore()
  const raw = clone(fullAppDataFixture()) as Partial<ReturnType<typeof fullAppDataFixture>>
  raw.version = 3
  delete raw.exerciseLibrary
  mainStore.values.set('appData', raw)
  stores.set('formlog.store.json', mainStore)
  const store = new LegacyAppDataStore(desktopEnvironment({ fileExists: true, stores }))

  const loaded = await store.load()
  equal(loaded.version, 4)
  equal(mainStore.saveCount, 0)
  const backupEntry = [...stores.entries()].find(([filename]) => filename.startsWith('formlog.store.pre-exercise-registry-'))
  strictEqual(Boolean(backupEntry), true)
  match(backupEntry![0], /^formlog\.store\.pre-exercise-registry-[a-z0-9]+\.backup\.json$/)
  deepStrictEqual(await backupEntry![1].get('appData'), raw)
  equal(backupEntry![1].saveCount, 1)
})

test('Legacy pre-import backup is create-once, verified and does not touch main Store', async () => {
  const stores = new Map<string, MemoryKeyValueStore>()
  const mainStore = new MemoryKeyValueStore()
  stores.set('formlog.store.json', mainStore)
  const store = new LegacyAppDataStore(desktopEnvironment({ fileExists: true, stores }))
  const fixture = fullAppDataFixture()

  await store.backupBeforeImport(fixture)
  await store.backupBeforeImport(fixture)

  const backupEntry = [...stores.entries()].find(([filename]) => filename.includes('.pre-import-'))
  strictEqual(Boolean(backupEntry), true)
  equal(backupEntry![1].saveCount, 1)
  deepStrictEqual(await backupEntry![1].get('appData'), fixture)
  equal(mainStore.saveCount, 0)
})

test('Legacy authority migration backup preserves raw data before normalization', async () => {
  const stores = new Map<string, MemoryKeyValueStore>()
  const mainStore = new MemoryKeyValueStore()
  const raw = clone(fullAppDataFixture()) as Partial<ReturnType<typeof fullAppDataFixture>>
  raw.version = 3
  delete raw.exerciseLibrary
  mainStore.values.set('appData', raw)
  stores.set('formlog.store.json', mainStore)
  const store = new LegacyAppDataStore(desktopEnvironment({ fileExists: true, stores }))

  const migrated = await store.loadForAuthorityMigration()

  equal(migrated.version, 4)
  const backupEntry = [...stores.entries()].find(([filename]) => filename.includes('.pre-v3-authority-'))
  strictEqual(Boolean(backupEntry), true)
  deepStrictEqual(await backupEntry![1].get('appData'), raw)
  equal(backupEntry![1].saveCount, 1)
  equal(mainStore.saveCount, 0)
})

test('Legacy save queue recovers after a rejected save and persists the next aggregate', async () => {
  const stores = new Map<string, MemoryKeyValueStore>()
  const mainStore = new MemoryKeyValueStore()
  mainStore.failNextSave = true
  stores.set('formlog.store.json', mainStore)
  const store = new LegacyAppDataStore(desktopEnvironment({ fileExists: true, stores }))
  const first = fullAppDataFixture()
  first.coachNotes.queue = 'first'
  const second = fullAppDataFixture()
  second.coachNotes.queue = 'second'

  await rejects(store.save(first), /Synthetic save failure/)
  await store.save(second)

  deepStrictEqual(await mainStore.get('appData'), second)
  equal(mainStore.saveCount, 2)
})

test('Legacy browser adapter keeps the exact current localStorage key and JSON boundary', async () => {
  const storage = new MemoryBrowserStorage()
  const store = new LegacyAppDataStore(browserEnvironment(storage))
  const fixture = fullAppDataFixture()

  await store.save(fixture)

  strictEqual(storage.getItem(STORAGE_KEY), JSON.stringify(fixture))
})
