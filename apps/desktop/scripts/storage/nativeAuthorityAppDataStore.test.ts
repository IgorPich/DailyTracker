import { deepStrictEqual, equal, rejects } from 'node:assert/strict'
import test from 'node:test'
import type { AppData } from '@greekgod/core'
import { prepareTemplateRepRange } from '@greekgod/core'
import { openProgramDraft, duplicateProgramTemplate, programVersion } from '@greekgod/core'
import { journalConfiguration, journalConfigurationBaseline, changeMetricTracking } from '@greekgod/core'
import { randomUUID } from 'node:crypto'
import { FakeCompanionModel } from '@greekgod/companion'
import { commandCandidates, createExplicitCommandSession, explicitUserCommandInput } from '@greekgod/companion/commands'
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
    if (expectedRevision !== this.revision) throw Object.assign(new Error('revision-conflict'), { kind: 'revision-conflict' })
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

test('journal configuration persists fresh authority once without changing histories or unrelated settings', async () => {
  const {data,bridge,store}=await commandFixture()
  const plan={baseline:journalConfigurationBaseline(data),configuration:changeMetricTracking(journalConfiguration(data),'CHEST','2026-09-01',true)}
  bridge.mutateExternally(current=>{current.settings.calorieTarget++;current.dailyEntries[0].weight=79})
  const before=clone(bridge.data!)
  const result=await store.saveJournal({kind:'CONFIGURATION',plan})
  equal(result.status,'APPLIED');equal(bridge.replacements,1)
  deepStrictEqual(bridge.data!.dailyEntries,before.dailyEntries)
  deepStrictEqual(bridge.data!.workouts,before.workouts)
  equal(bridge.data!.settings.calorieTarget,before.settings.calorieTarget)
  equal((await store.saveJournal({kind:'CONFIGURATION',plan})).status,'STALE')
  equal(bridge.replacements,1)
})

test('journal field save preserves unknown and inactive values and rejects touched-field conflict', async () => {
  const {data,bridge,store}=await commandFixture(), baseline=clone(data.dailyEntries[0])
  const plan={date:baseline.date,newId:randomUUID(),baseline,changes:[],metricChanges:[{metricId:'CHEST',action:'SET' as const,value:101.5}]}
  bridge.mutateExternally(current=>{current.dailyEntries[0].weight=79;current.dailyEntries[0].measurements={BICEPS:37,FUTURE:10}})
  const result=await store.saveJournal({kind:'ENTRY',plan})
  equal(result.status,'APPLIED');equal(bridge.replacements,1)
  const saved=bridge.data!.dailyEntries.find(entry=>entry.id===baseline.id)!
  equal(saved.weight,79);deepStrictEqual(saved.measurements,{BICEPS:37,FUTURE:10,CHEST:101.5})
  equal(bridge.data!.dailyEntries.filter(entry=>entry.date===baseline.date).length,1)
  equal((await store.saveJournal({kind:'ENTRY',plan})).status,'STALE');equal(bridge.replacements,1)
})

test('journal disk/CAS/lost acknowledgement never blindly retry; UI sees durable data only', async () => {
  for(const mode of ['disk','cas','lost'] as const){
    const {data,bridge,store}=await commandFixture(), baseline=clone(data.dailyEntries[0])
    const replace=bridge.replaceAuthority.bind(bridge)
    bridge.replaceAuthority=async(desired,revision)=>{
      if(mode==='disk')throw new Error('Synthetic disk failure')
      if(mode==='cas')bridge.mutateExternally(current=>{current.settings.calorieTarget++})
      const result=await replace(desired,revision)
      if(mode==='lost')throw new Error('Lost acknowledgement')
      return result
    }
    const coordinator=new DesktopDataCoordinator(data,store,()=>{},()=>{})
    const result=await coordinator.saveJournal({kind:'ENTRY',plan:{date:baseline.date,newId:randomUUID(),baseline,changes:[{field:'weight',action:'SET',value:79}]}})
    equal(result.status,mode==='disk'?'PERSISTENCE_FAILED':mode==='cas'?'STALE':'INDETERMINATE')
    equal(bridge.replacements,mode==='lost'?1:0)
  }
})

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

test('program save patches fresh authority, preserves newer journal/workout/settings and writes once', async () => {
  const { data, bridge, store } = await commandFixture()
  const plan = openProgramDraft(data.templates)
  plan.templates[0].name = 'Arbitrary new program label'
  while (plan.templates.length < 8) plan.templates.push(duplicateProgramTemplate(plan.templates[0], randomUUID))
  bridge.mutateExternally((current) => {
    current.dailyEntries[0].weight = 77.7
    current.workouts.push({ ...clone(current.workouts[0]), id: randomUUID() })
    current.settings.calorieTarget++
  })
  const fresh = clone(bridge.data!)
  let published = data
  const coordinator = new DesktopDataCoordinator(data, store, (next) => { published = next }, () => {})
  const result = await coordinator.saveProgram(plan)
  equal(result.status, 'APPLIED'); await store.load(); equal(bridge.replacements, 1)
  equal(published.templates.length, 8)
  deepStrictEqual({ ...published, templates: fresh.templates }, fresh)
  deepStrictEqual(data.templates, openProgramDraft(data.templates).templates)
})

test('program stale validation sees queued edits; invalid/legacy plans never write', async () => {
  const { data, bridge, store } = await commandFixture()
  const plan = openProgramDraft(data.templates); plan.templates[0].name = 'Sandbox name'
  const ordinary = clone(data); ordinary.templates.reverse()
  const queued = store.save(ordinary)
  const saved = store.saveProgram(plan)
  await queued; equal((await saved).status, 'STALE_PROGRAM'); equal(bridge.replacements, 1)
  const invalid = openProgramDraft(ordinary.templates); invalid.templates = []
  equal((await store.saveProgram(invalid)).status, 'VALIDATION_FAILED'); equal(bridge.replacements, 1)
  const legacy = new DesktopDataCoordinator(data, new LegacyMigrationSource(data), () => {}, () => {})
  equal((await legacy.saveProgram(plan)).status, 'BLOCKED')
})

test('program waits for durable acknowledgement, rebase ordinary updates, no duplicate effect save', async () => {
  const { data, bridge, store } = await commandFixture()
  const plan = openProgramDraft(data.templates); plan.templates[0].name = 'Program change'
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const writing = new Promise<void>((resolve) => { entered = resolve })
  const replace = bridge.replaceAuthority.bind(bridge)
  bridge.replaceAuthority = async (desired, revision) => { entered(); await gate; return replace(desired, revision) }
  let published = data, done = false
  const coordinator = new DesktopDataCoordinator(data, store, (next) => { published = next }, () => {})
  const save = coordinator.saveProgram(plan).then((result) => { done = true; return result })
  await writing; equal(done, false); equal(published, data)
  coordinator.update((current) => ({ ...current, coachNotes: { ...current.coachNotes, synthetic: 'New ordinary note' } }))
  release(); equal((await save).status, 'APPLIED'); await store.load()
  equal(bridge.replacements, 2) // one program transaction and one deliberate ordinary edit
  equal(published.templates[0].name, plan.templates[0].name)
  equal(bridge.data!.coachNotes.synthetic, 'New ordinary note')
})

test('program disk failure, CAS conflict and lost acknowledgement are distinguished without replay', async () => {
  for (const mode of ['disk', 'cas', 'lost'] as const) {
    const { data, bridge, store } = await commandFixture()
    const plan = openProgramDraft(data.templates); plan.templates[0].name = 'Program change'
    const replace = bridge.replaceAuthority.bind(bridge)
    bridge.replaceAuthority = async (desired, revision) => {
      if (mode === 'disk') throw new Error('Synthetic disk failure')
      if (mode === 'cas') bridge.mutateExternally((current) => { current.settings.calorieTarget++ })
      const result = await replace(desired, revision)
      if (mode === 'lost') throw new Error('Lost acknowledgement')
      return result
    }
    const coordinator = new DesktopDataCoordinator(data, store, () => {}, () => {})
    const result = await coordinator.saveProgram(plan)
    equal(result.status, mode === 'disk' ? 'PERSISTENCE_FAILED' : mode === 'cas' ? 'STALE_PROGRAM' : 'INDETERMINATE')
    equal(bridge.replacements, mode === 'lost' ? 1 : 0)
    if (result.status === 'INDETERMINATE') equal(result.desiredProgramPresent, true)
  }
})

test('unavailable program reconciliation blocks both save capabilities until authority is reread', async () => {
  const { data, bridge, store } = await commandFixture()
  const plan = openProgramDraft(data.templates); plan.templates.reverse()
  const read = bridge.loadAuthority.bind(bridge)
  bridge.replaceAuthority = async () => { bridge.loadAuthority = async () => { throw new Error('Offline') }; throw new Error('Unknown write') }
  const coordinator = new DesktopDataCoordinator(data, store, () => {}, () => {})
  equal((await coordinator.saveProgram(plan)).status, 'INDETERMINATE')
  equal(coordinator.supportsProgramSave, false); equal(coordinator.supportsConfirmedTrackingMutations, false)
  bridge.loadAuthority = read
  await coordinator.poll(); equal(coordinator.supportsProgramSave, true)
  equal(bridge.replacements, 0); equal(programVersion(bridge.data!.templates), plan.baseline)
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
  let entered!: () => void
  const writing = new Promise<void>((resolve) => { entered = resolve })
  const replace = bridge.replaceAuthority.bind(bridge)
  bridge.replaceAuthority = async (desired, revision) => { entered(); await gate; return replace(desired, revision) }
  let published = data, finished = false
  const coordinator = new DesktopDataCoordinator(data, store, (next) => { published = next }, () => {})
  const pending = coordinator.changeTemplateRepRange(plan).then((result) => { finished = true; return result })
  await writing
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

test('lost acknowledgement reconciles saved state without false APPLIED or automatic replay', async () => {
  const { bridge, store, plan, data } = await commandFixture()
  const replace = bridge.replaceAuthority.bind(bridge)
  bridge.replaceAuthority = async (desired, revision) => { await replace(desired, revision); throw new Error('Lost acknowledgement') }
  const coordinator = new DesktopDataCoordinator(data, store, () => {}, () => {})
  const result = await coordinator.changeTemplateRepRange(plan)
  equal(result.status, 'INDETERMINATE')
  if (result.status === 'INDETERMINATE') deepStrictEqual(result.reconciliation, { desiredStatePresent: true, observedPrescription: plan.afterPrescription })
  equal(bridge.replacements, 1)
  equal(bridge.data!.templates[0].exercises[0].prescription, plan.afterPrescription)
})

test('explicit envelope through fake, bound confirmation, coordinator and authority writes exactly once', async () => {
  const { bridge, store, data, plan } = await commandFixture()
  const coordinator = new DesktopDataCoordinator(data, store, () => {}, () => {})
  const session = createExplicitCommandSession(coordinator)
  const target = commandCandidates(data).find((item) => item.templateExerciseId === plan.templateExerciseId)!
  const preview = await session.prepare(explicitUserCommandInput('Synthetic explicit request'), data,
    new FakeCompanionModel({ action: plan.action, candidateRefs: [target.reference], minReps: plan.minReps, maxReps: plan.maxReps }))
  equal(bridge.replacements, 0); equal(preview.status, 'PREVIEWED')
  if (preview.status !== 'PREVIEWED') return
  const confirmed = session.confirm(preview)
  equal((await session.execute(confirmed)).status, 'APPLIED')
  equal((await session.execute(confirmed)).status, 'FAILED')
  equal(bridge.replacements, 1)
})

test('ordinary React edit during a command is deferred and rebased onto committed state', async () => {
  const { bridge, store, plan, data } = await commandFixture()
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const writing = new Promise<void>((resolve) => { entered = resolve })
  const replace = bridge.replaceAuthority.bind(bridge)
  bridge.replaceAuthority = async (desired, revision) => { entered(); await gate; return replace(desired, revision) }
  const coordinator = new DesktopDataCoordinator(data, store, () => {}, () => {})
  const pending = coordinator.changeTemplateRepRange(plan)
  await writing
  coordinator.update((current) => ({ ...current, settings: { ...current.settings, calorieTarget: current.settings.calorieTarget + 1 } }))
  equal(bridge.replacements, 0)
  release(); equal((await pending).status, 'APPLIED'); await store.load()
  equal(bridge.replacements, 2) // one confirmed change + one deliberate ordinary edit, no effect duplicate
  equal(bridge.data!.templates[0].exercises[0].prescription, plan.afterPrescription)
  equal(bridge.data!.settings.calorieTarget, data.settings.calorieTarget + 1)
})

test('unavailable reconciliation holds ordinary edits and blocks further commands until refresh', async () => {
  const { bridge, store, plan, data } = await commandFixture()
  const read = bridge.loadAuthority.bind(bridge)
  bridge.replaceAuthority = async () => {
    bridge.loadAuthority = async () => { throw new Error('Offline read') }
    throw new Error('Unacknowledged failure')
  }
  const outcomes: unknown[] = []
  const coordinator = new DesktopDataCoordinator(data, store, () => {}, () => {}, (result) => outcomes.push(result))
  equal((await coordinator.changeTemplateRepRange(plan)).status, 'INDETERMINATE')
  equal(coordinator.supportsConfirmedTrackingMutations, false)
  coordinator.update((current) => ({ ...current, settings: { ...current.settings, calorieTarget: current.settings.calorieTarget + 1 } }))
  equal(bridge.replacements, 0)
  bridge.loadAuthority = read
  bridge.replaceAuthority = FakeAuthorityBridge.prototype.replaceAuthority.bind(bridge)
  await coordinator.poll(); await store.load()
  equal(bridge.replacements, 1); equal(coordinator.supportsConfirmedTrackingMutations, true)
  deepStrictEqual((outcomes.at(-1) as { reconciliation: unknown }).reconciliation,
    { desiredStatePresent: false, observedPrescription: plan.beforePrescription })
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
