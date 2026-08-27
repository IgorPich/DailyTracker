import { deepStrictEqual, equal, rejects } from 'node:assert/strict'
import test from 'node:test'
import type { AppData } from '@greekgod/core'
import {
  DevelopmentAuthoritativeAppDataStore,
  type LegacyAuthorityMigrationSource,
  type NativeAuthorityBridge,
} from '../../src/services/nativeAuthorityBridge.ts'
import { normalizeData } from '../../src/utils/storage.ts'
import { fullAppDataFixture } from '../fixtures/full-app-data.fixture.ts'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

class LegacyMigrationSource implements LegacyAuthorityMigrationSource {
  migrationLoads = 0
  ordinaryLoads = 0
  saves = 0
  imports = 0

  constructor(private readonly data = fullAppDataFixture()) {}

  async loadForAuthorityMigration() {
    this.migrationLoads += 1
    return clone(this.data)
  }

  async load() {
    this.ordinaryLoads += 1
    return clone(this.data)
  }

  async save() {
    this.saves += 1
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
