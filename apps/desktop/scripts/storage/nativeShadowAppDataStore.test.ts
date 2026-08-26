import { deepStrictEqual, equal, rejects } from 'node:assert/strict'
import test from 'node:test'
import type { AppData, AppDataStore } from '@greekgod/core'
import {
  DevelopmentShadowAppDataStore,
  semanticJsonDifference,
} from '../../src/services/nativeStorageBridge.ts'
import type {
  NativeStorageBridge,
  NativeStorageProbeResponse,
} from '../../src/services/nativeStorageBridge.ts'
import { fullAppDataFixture } from '../fixtures/full-app-data.fixture.ts'

class MemoryStore implements AppDataStore {
  data: AppData
  saves = 0
  backups = 0

  constructor(data = fullAppDataFixture()) {
    this.data = structuredClone(data)
  }

  async load() {
    return structuredClone(this.data)
  }

  async save(data: AppData) {
    this.saves += 1
    this.data = structuredClone(data)
  }

  async backupBeforeImport() {
    this.backups += 1
  }
}

class FakeNativeBridge implements NativeStorageBridge {
  replacements = 0
  loads = 0
  backups = 0
  mutate: (data: AppData) => unknown = (data) => JSON.parse(JSON.stringify(data)) as unknown
  private shadowData: unknown

  constructor(private readonly probeResponse: NativeStorageProbeResponse) {
    this.shadowData = this.mutate(fullAppDataFixture())
  }

  async probe() {
    return this.probeResponse
  }

  async replaceShadow(data: AppData) {
    this.replacements += 1
    this.shadowData = this.mutate(data)
    return { enabled: this.probeResponse.enabled, data: this.shadowData }
  }

  async loadShadow() {
    this.loads += 1
    return { enabled: this.probeResponse.enabled, data: this.shadowData }
  }

  async backupShadowBeforeImport(data: AppData) {
    this.backups += 1
    this.shadowData = this.mutate(data)
    return {
      enabled: this.probeResponse.enabled,
      data: this.shadowData,
      backupPath: 'C:\\isolated\\greekgod-v3.sqlite.pre-import-test.backup.sqlite',
    }
  }
}

test('development shadow is a no-op when the native runtime is disabled', async () => {
  const legacy = new MemoryStore()
  const bridge = new FakeNativeBridge({ enabled: false })
  const store = new DevelopmentShadowAppDataStore(legacy, bridge)

  await store.load()
  await store.save(fullAppDataFixture())

  equal(bridge.replacements, 0)
  equal(bridge.loads, 0)
  equal(legacy.saves, 1)
})

test('development shadow copies and verifies Legacy data on load and save', async () => {
  const legacy = new MemoryStore()
  const bridge = new FakeNativeBridge({ enabled: true })
  const store = new DevelopmentShadowAppDataStore(legacy, bridge)

  const loaded = await store.load()
  await store.save(loaded)

  equal(bridge.replacements, 2)
  equal(bridge.loads, 2)
  deepStrictEqual(loaded, await legacy.load())
})

test('development shadow fails hard with the first exact semantic difference', async () => {
  const legacy = new MemoryStore()
  const bridge = new FakeNativeBridge({ enabled: true })
  bridge.mutate = (data) => {
    const changed = JSON.parse(JSON.stringify(data)) as AppData
    changed.workouts[0].exercises[0].sets[0].reps = 999
    return changed
  }
  const store = new DevelopmentShadowAppDataStore(legacy, bridge)

  await rejects(store.load(), /\$\.workouts\[0\]\.exercises\[0\]\.sets\[0\]\.reps/)
})

test('development shadow compares the JSON persistence boundary without ignoring fields', async () => {
  const fixture = fullAppDataFixture()
  fixture.exerciseLibrary[0].aliases = undefined
  const legacy = new MemoryStore(fixture)
  const bridge = new FakeNativeBridge({ enabled: true })
  const store = new DevelopmentShadowAppDataStore(legacy, bridge)

  await store.load()

  equal(bridge.replacements, 1)
  equal(
    semanticJsonDifference({ value: 1 }, { value: 1, extra: undefined }),
    '$: object keys ["value"] != ["extra","value"]',
  )
})

test('development shadow creates and verifies both Legacy and native import backups', async () => {
  const legacy = new MemoryStore()
  const bridge = new FakeNativeBridge({ enabled: true })
  const store = new DevelopmentShadowAppDataStore(legacy, bridge)

  await store.backupBeforeImport(fullAppDataFixture())

  equal(legacy.backups, 1)
  equal(bridge.backups, 1)
})
