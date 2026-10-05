import { deepStrictEqual, equal, rejects } from 'node:assert/strict'
import test from 'node:test'
import type { AppData } from '@greekgod/core'
import {
  DevelopmentAuthoritativeAppDataStore,
  ProductionSafeAuthoritativeAppDataStore,
  type LegacyAuthorityMigrationSource,
  type NativeAuthorityBridge,
} from '../../src/services/nativeAuthorityBridge.ts'
import { normalizeData } from '../../src/utils/storage.ts'
import { fullAppDataFixture } from '../fixtures/full-app-data.fixture.ts'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const schemaEightFixture = (): AppData => {
  const data = fullAppDataFixture()
  data.dailyEntries[0].measurements = { CHEST: 101.5, BICEPS: 36 }
  data.templates[0].code = 'PPL-X'
  data.settings.journalConfiguration = {
    version: 1,
    metrics: [{
      metricId: 'CHEST',
      initiallyTracked: true,
      transitions: [{ from: '2026-01-01', tracked: true }],
    }],
  }
  Object.assign(data.dailyEntries[0], { additiveDailyMetadata: { retained: true } })
  Object.assign(data.templates[0], { additiveTemplateMetadata: { cycle: 'sanitized' } })
  Object.assign(data.settings, { additiveSettingsMetadata: ['retained'] })
  return data
}

class LegacyMigrationSource implements LegacyAuthorityMigrationSource {
  migrationLoads = 0
  ordinaryLoads = 0
  saves = 0
  imports = 0

  constructor(private data = fullAppDataFixture()) {}

  async loadForAuthorityMigration() {
    this.migrationLoads += 1
    return clone(this.data)
  }

  async load() {
    this.ordinaryLoads += 1
    return clone(this.data)
  }

  async save(data: AppData) {
    this.saves += 1
    this.data = clone(data)
  }

  async backupBeforeImport() {
    this.imports += 1
  }
}

class FakeAuthorityBridge implements NativeAuthorityBridge {
  bootstrapped = false
  revision = 0
  data: AppData | undefined
  bootstraps = 0
  replacements = 0
  backups = 0
  bootstrapBackupPath = 'C:\\isolated\\greekgod-v3.sqlite.pre-import.backup.sqlite'
  bootstrapFailure = false

  async authorityStatus() {
    return {
      enabled: true,
      status: {
        bootstrapped: this.bootstrapped,
        globalRevision: this.revision,
        materializedRevision: this.revision,
        dataVersion: this.bootstrapped ? 4 : undefined,
        mirrorPresent: this.data !== undefined,
      },
    }
  }

  async bootstrapAuthority(data: AppData) {
    if (this.bootstrapFailure) throw new Error('synthetic-bootstrap-mismatch')
    this.bootstraps += 1
    this.bootstrapped = true
    this.revision = 9
    this.data = clone(data)
    return {
      enabled: true,
      data: clone(this.data),
      revision: this.revision,
      backupPath: this.bootstrapBackupPath || undefined,
    }
  }

  async loadAuthority() {
    return { enabled: true, data: clone(this.data), revision: this.revision }
  }

  async replaceAuthority(data: AppData, expectedRevision: number) {
    if (expectedRevision !== this.revision) throw new Error('revision-conflict')
    this.replacements += 1
    this.revision += 1
    this.data = clone(data)
    return { enabled: true, data: clone(this.data), revision: this.revision, appliedOperations: 1 }
  }

  async backupAuthorityBeforeImport(data: AppData) {
    this.backups += 1
    if (JSON.stringify(data) !== JSON.stringify(this.data)) throw new Error('backup mismatch')
    return {
      enabled: true,
      data: clone(this.data),
      revision: this.revision,
      backupPath: 'C:\\isolated\\verified-authority.backup.sqlite',
    }
  }

  mutateExternally(mutator: (data: AppData) => void) {
    if (!this.data) throw new Error('authority is not bootstrapped')
    mutator(this.data)
    this.revision += 1
  }
}

test('authority bootstrap verifies backups and permanently stops writing Legacy Store', async () => {
  const legacy = new LegacyMigrationSource()
  const bridge = new FakeAuthorityBridge()
  const store = new DevelopmentAuthoritativeAppDataStore(legacy, bridge)

  const loaded = await store.load()
  loaded.coachNotes.authority = 'SQLite only'
  await store.save(loaded)
  await store.backupBeforeImport(loaded)

  equal(legacy.migrationLoads, 1)
  equal(legacy.ordinaryLoads, 0)
  equal(legacy.saves, 0)
  equal(legacy.imports, 0)
  equal(bridge.bootstraps, 1)
  equal(bridge.replacements, 1)
  equal(bridge.backups, 1)
  deepStrictEqual(await store.load(), loaded)
})

test('authority serializes desktop saves and uses the revision returned by each commit', async () => {
  const legacy = new LegacyMigrationSource()
  const bridge = new FakeAuthorityBridge()
  const store = new DevelopmentAuthoritativeAppDataStore(legacy, bridge)
  await store.load()
  const first = fullAppDataFixture()
  first.coachNotes.order = 'first'
  const second = fullAppDataFixture()
  second.coachNotes.order = 'second'

  await Promise.all([store.save(first), store.save(second)])

  equal(bridge.replacements, 2)
  deepStrictEqual(await store.load(), normalizeData(clone(second)))
})

test('revision polling reloads an externally committed sync mutation', async () => {
  const legacy = new LegacyMigrationSource()
  const bridge = new FakeAuthorityBridge()
  const store = new DevelopmentAuthoritativeAppDataStore(legacy, bridge)
  await store.load()
  bridge.mutateExternally((data) => { data.coachNotes.mobile = 'synced' })

  const changed = await store.loadIfChanged()

  equal(changed?.coachNotes.mobile, 'synced')
  equal(await store.loadIfChanged(), undefined)
})

test('existing schema-8 AppData preserves hidden additive fields through a normal 3.x edit', async () => {
  const fixture = schemaEightFixture()
  const legacy = new LegacyMigrationSource(fixture)
  const bridge = new FakeAuthorityBridge()
  bridge.bootstrapped = true
  bridge.revision = 8
  bridge.data = clone(fixture)
  const store = new DevelopmentAuthoritativeAppDataStore(legacy, bridge)

  const loaded = await store.load()
  loaded.dailyEntries[0] = {
    ...loaded.dailyEntries[0],
    weight: 81.8,
    note: '3.x visible edit',
  }
  loaded.settings.calorieTarget = 3000
  await store.save(loaded)
  const reopened = await store.load()

  deepStrictEqual(reopened.dailyEntries[0].measurements, { CHEST: 101.5, BICEPS: 36 })
  deepStrictEqual(
    (reopened.dailyEntries[0] as typeof reopened.dailyEntries[0] & { additiveDailyMetadata: unknown }).additiveDailyMetadata,
    { retained: true },
  )
  equal(reopened.templates[0].code, 'PPL-X')
  deepStrictEqual(
    (reopened.templates[0] as typeof reopened.templates[0] & { additiveTemplateMetadata: unknown }).additiveTemplateMetadata,
    { cycle: 'sanitized' },
  )
  deepStrictEqual(reopened.settings.journalConfiguration, fixture.settings.journalConfiguration)
  deepStrictEqual(
    (reopened.settings as typeof reopened.settings & { additiveSettingsMetadata: unknown }).additiveSettingsMetadata,
    ['retained'],
  )
  equal(reopened.dailyEntries[0].weight, 81.8)
  equal(reopened.settings.calorieTarget, 3000)
})

test('stale desktop snapshot fails closed instead of overwriting external data', async () => {
  const legacy = new LegacyMigrationSource()
  const bridge = new FakeAuthorityBridge()
  const store = new DevelopmentAuthoritativeAppDataStore(legacy, bridge)
  const stale = await store.load()
  bridge.mutateExternally((data) => { data.coachNotes.mobile = 'newer' })
  stale.coachNotes.desktop = 'stale'

  await rejects(store.save(stale), /revision-conflict/)
  equal(bridge.data?.coachNotes.mobile, 'newer')
  equal(bridge.data?.coachNotes.desktop, undefined)
})

test('missing verified bootstrap backup blocks the cutover', async () => {
  const legacy = new LegacyMigrationSource()
  const bridge = new FakeAuthorityBridge()
  bridge.bootstrapBackupPath = ''
  const store = new DevelopmentAuthoritativeAppDataStore(legacy, bridge)

  await rejects(store.load(), /verified pre-migration backup/)
})

test('production cutover falls back to live Legacy only when initial bootstrap comparison fails', async () => {
  const legacy = new LegacyMigrationSource()
  const bridge = new FakeAuthorityBridge()
  bridge.bootstrapFailure = true
  const store = new ProductionSafeAuthoritativeAppDataStore(legacy, bridge)

  const loaded = await store.load()
  loaded.coachNotes.fallback = 'legacy remains active'
  await store.save(loaded)
  await store.backupBeforeImport(loaded)

  equal(legacy.migrationLoads, 1)
  equal(legacy.saves, 1)
  equal(legacy.imports, 1)
  equal(bridge.bootstrapped, false)
  deepStrictEqual(await store.load(), clone(loaded))
})
