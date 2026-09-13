import { deepStrictEqual, equal, rejects } from 'node:assert/strict'
import test from 'node:test'
import type { AppData } from '@greekgod/core'
import { prepareTemplateRepRange } from '@greekgod/core'
import { randomUUID } from 'node:crypto'
import { DesktopDataCoordinator } from '../../src/services/desktopDataCoordinator.ts'
import {
  DevelopmentAuthoritativeAppDataStore,
  ProductionSafeAuthoritativeAppDataStore,
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

const commandFixture = async () => {
  const data = normalizeData(fullAppDataFixture())
  const template = data.templates[0], row = template.exercises[0]
  template.id = randomUUID(); row.id = randomUUID(); row.exerciseId = randomUUID(); row.prescription = '3 × 8–12'
  data.exerciseLibrary.push({ id: row.exerciseId, name: row.name, equipmentSensitive: false })
  const bridge = new FakeAuthorityBridge()
  bridge.bootstrapped = true; bridge.revision = 40; bridge.data = clone(data)
  const store = new DevelopmentAuthoritativeAppDataStore(new LegacyMigrationSource(data), bridge)
  await store.load()
  const plan = prepareTemplateRepRange(data, { templateId: template.id, templateExerciseId: row.id, exerciseId: row.exerciseId }, 10, 15)
  return { data, bridge, store, plan }
}

test('confirmed rep change persists exactly once with receipt; histories/IDs/other rows preserved', async () => {
  const { data, bridge, store, plan } = await commandFixture()
  bridge.mutateExternally((current) => { current.settings.calorieTarget += 1 })
  const result = await store.changeTemplateRepRange(plan)
  equal(result.status, 'APPLIED'); equal(bridge.replacements, 1)
  if (result.status !== 'APPLIED') return
  equal(result.receipt.resultingRevision, bridge.revision)
  equal(result.receipt.beforePrescription, '3 × 8–12'); equal(result.receipt.afterPrescription, '3 × 10–15')
  equal(result.data.templates[0].exercises[0].exerciseId, plan.exerciseId)
  deepStrictEqual(result.data.workouts, data.workouts)
  deepStrictEqual(result.data.templates.slice(1), data.templates.slice(1))
  deepStrictEqual(result.data.templates[0].exercises.slice(1), data.templates[0].exercises.slice(1))
  equal(result.data.settings.calorieTarget, data.settings.calorieTarget + 1)
})

for (const change of ['prescription', 'identity', 'deleted', 'queued'] as const) {
  test(`target ${change} after preview is STALE with zero command writes`, async () => {
    const { bridge, store, plan, data } = await commandFixture()
    if (change === 'queued') {
      const edited = clone(data); edited.templates[0].exercises[0].prescription = '3 × 5–7'
      const ordinary = store.save(edited)
      const command = store.changeTemplateRepRange(plan)
      await ordinary; equal((await command).status, 'STALE'); equal(bridge.replacements, 1)
    } else {
      bridge.mutateExternally((current) => {
        if (change === 'deleted') current.templates[0].exercises.shift()
        else if (change === 'identity') current.templates[0].exercises[0].exerciseId = randomUUID()
        else current.templates[0].exercises[0].prescription = '3 × 5–7'
      })
      equal((await store.changeTemplateRepRange(plan)).status, 'STALE'); equal(bridge.replacements, 0)
    }
  })
}

test('failed persistence is FAILED not APPLIED, queue recovers, CAS race is STALE', async () => {
  const { bridge, store, plan } = await commandFixture()
  const replace = bridge.replaceAuthority.bind(bridge)
  bridge.replaceAuthority = async () => { throw new Error('Synthetic disk failure') }
  equal((await store.changeTemplateRepRange(plan)).status, 'FAILED'); equal(bridge.replacements, 0)
  bridge.replaceAuthority = async (desired, revision) => {
    bridge.mutateExternally((current) => { current.settings.calorieTarget++ })
    return replace(desired, revision)
  }
  equal((await store.changeTemplateRepRange(plan)).status, 'STALE'); equal(bridge.replacements, 0)
})

test('React coordinator waits for durability and does not duplicate effect save; deferred UI updates preserve commit', async () => {
  const { bridge, store, plan, data } = await commandFixture()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const replace = bridge.replaceAuthority.bind(bridge)
  bridge.replaceAuthority = async (desired, revision) => { await gate; return replace(desired, revision) }
  let published = data, finished = false
  const coordinator = new DesktopDataCoordinator(data, store, (next) => { published = next }, () => {})
  const pending = coordinator.changeTemplateRepRange(plan).then((result) => { finished = true; return result })
  await Promise.resolve(); await Promise.resolve()
  equal(finished, false); equal(published, data); equal(bridge.replacements, 0)
  release()
  equal((await pending).status, 'APPLIED')
  await store.load(); equal(bridge.replacements, 1)
  equal(published.templates[0].exercises[0].prescription, '3 × 10–15')
  coordinator.update((current) => ({ ...current, settings: { ...current.settings, calorieTarget: current.settings.calorieTarget + 1 } }))
  await store.load(); equal(bridge.replacements, 2)
  equal(bridge.data!.templates[0].exercises[0].prescription, '3 × 10–15')
})

test('legacy capability blocks execution without persistence or React success', async () => {
  const { data, plan } = await commandFixture()
  const legacy = new LegacyMigrationSource(data)
  const coordinator = new DesktopDataCoordinator(data, legacy, () => { throw new Error('Unexpected publication') }, () => {})
  equal(coordinator.supportsConfirmedTrackingMutations, false)
  equal((await coordinator.changeTemplateRepRange(plan)).status, 'BLOCKED'); equal(legacy.saves, 0)
})

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
