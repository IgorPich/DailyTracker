import type { AppData, AppDataStore } from '@greekgod/core'
import { changeTemplateRepRange as applyRepRange, type TemplateRepRangePlan } from '@greekgod/core'
import { applyProgram, programVersion, type ProgramPlan } from '@greekgod/core'
import type { ProgramPersistence, ProgramSaveResult } from './programPersistence.ts'
import { applyDailyEntryEdit, applyJournalConfiguration } from '@greekgod/core'
import type { JournalMutation, JournalSaveResult } from './journalPersistence.ts'
import type { ConfirmedTrackingPersistence, TrackingMutationResult } from './confirmedTrackingMutation.ts'
import { normalizeData } from '../utils/storage'
import { jsonBoundaryValue, semanticJsonDifference } from './nativeStorageBridge'

export interface NativeAuthorityStatus {
  bootstrapped: boolean
  globalRevision: number
  materializedRevision: number
  dataVersion?: number
  mirrorPresent: boolean
}

export interface NativeAuthorityStatusResponse {
  enabled: boolean
  status?: NativeAuthorityStatus
}

export interface NativeAuthorityResponse {
  enabled: boolean
  data?: unknown
  revision?: number
  appliedOperations?: number
  backupPath?: string
}

export interface NativeAuthorityBridge {
  authorityStatus(): Promise<NativeAuthorityStatusResponse>
  bootstrapAuthority(data: AppData): Promise<NativeAuthorityResponse>
  loadAuthority(): Promise<NativeAuthorityResponse>
  replaceAuthority(data: AppData, expectedRevision: number): Promise<NativeAuthorityResponse>
  backupAuthorityBeforeImport(data: AppData): Promise<NativeAuthorityResponse>
}

export interface LegacyAuthorityMigrationSource extends AppDataStore {
  loadForAuthorityMigration(): Promise<AppData>
}

const parsedAppData = (raw: unknown): AppData => {
  const normalized = normalizeData(raw)
  const difference = semanticJsonDifference(jsonBoundaryValue(normalized), raw)
  if (difference) throw new Error(`Native SQLite authority contains invalid AppData at ${difference}`)
  return normalized
}

const requiredStatus = (response: NativeAuthorityStatusResponse): NativeAuthorityStatus => {
  if (!response.enabled || !response.status) {
    throw new Error('Native SQLite authority is unavailable in this application composition.')
  }
  return response.status
}

const requiredSnapshot = (response: NativeAuthorityResponse): { data: AppData; revision: number } => {
  if (!response.enabled || response.data === undefined || response.revision === undefined) {
    throw new Error('Native SQLite authority returned an incomplete response.')
  }
  if (!Number.isSafeInteger(response.revision) || response.revision < 0) {
    throw new Error('Native SQLite authority returned an invalid revision.')
  }
  return { data: parsedAppData(response.data), revision: response.revision }
}

export class DevelopmentAuthoritativeAppDataStore implements AppDataStore, ConfirmedTrackingPersistence, ProgramPersistence {
  private revision: number | undefined
  private initialization: Promise<AppData> | undefined
  private saveQueue: Promise<void> = Promise.resolve()
  private legacyFallback = false

  constructor(
    private readonly legacy: LegacyAuthorityMigrationSource,
    private readonly nativeBridge: NativeAuthorityBridge,
    private readonly options: { fallbackToLegacyOnBootstrapFailure?: boolean } = {},
  ) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.saveQueue.catch(() => undefined).then(operation)
    this.saveQueue = next.then(() => undefined, () => undefined)
    return next
  }

  get supportsConfirmedTrackingMutations() { return this.revision !== undefined && !this.legacyFallback }
  get supportsProgramSave() { return this.supportsConfirmedTrackingMutations }
  get supportsJournalSave() { return this.supportsConfirmedTrackingMutations }

  saveJournal(request: JournalMutation): Promise<JournalSaveResult> {
    const intent = structuredClone(request)
    return this.enqueue(async () => {
      if (!this.supportsJournalSave) return {status:'BLOCKED',message:'Safe native authority required'}
      let attempted = false
      try {
        const current = requiredSnapshot(await this.nativeBridge.loadAuthority())
        this.revision = current.revision
        let desired: AppData
        try { desired = intent.kind === 'ENTRY' ? applyDailyEntryEdit(current.data,intent.plan) : applyJournalConfiguration(current.data,intent.plan) }
        catch (error) { return {status:String(error).includes('STALE')?'STALE':'VALIDATION_FAILED',message:String(error)} }
        if (desired === current.data || !semanticJsonDifference(jsonBoundaryValue(desired),jsonBoundaryValue(current.data))) return {status:'APPLIED',data:current.data}
        attempted = true
        let saved
        try { saved = requiredSnapshot(await this.nativeBridge.replaceAuthority(desired,current.revision)) }
        catch (error) {
          const latest = requiredSnapshot(await this.nativeBridge.loadAuthority()); this.revision = latest.revision
          if (error && typeof error === 'object' && 'kind' in error && error.kind === 'revision-conflict') return {status:'STALE',message:'Authority changed; refresh/review'}
          return {status:latest.revision === current.revision?'PERSISTENCE_FAILED':'INDETERMINATE',message:'Write not confirmed; refresh/review, no automatic retry'}
        }
        this.verifyExpected(desired,saved.data,'journal save'); this.revision = saved.revision
        return {status:'APPLIED',data:saved.data}
      } catch { return {status:attempted?'INDETERMINATE':'PERSISTENCE_FAILED',message:'Authority unavailable; refresh before saving again'} }
    })
  }

  saveProgram(plan: ProgramPlan): Promise<ProgramSaveResult> {
    const draft = structuredClone(plan)
    return this.enqueue(async () => {
      if (!this.supportsProgramSave) return { status: 'BLOCKED', message: 'Safe native authority required' }
      let attempted = false
      try {
        const current = requiredSnapshot(await this.nativeBridge.loadAuthority())
        this.revision = current.revision
        if (programVersion(current.data.templates) !== draft.baseline) return { status: 'STALE_PROGRAM', message: 'Program changed; refresh and review the draft' }
        let desired: AppData
        try { desired = applyProgram(current.data, draft) }
        catch { return { status: 'VALIDATION_FAILED', message: 'Invalid program or unresolved exercise reference' } }
        if (programVersion(desired.templates) === draft.baseline) return { status: 'APPLIED', data: current.data, resultingRevision: current.revision }
        let saved: { data: AppData; revision: number }
        try {
          attempted = true
          saved = requiredSnapshot(await this.nativeBridge.replaceAuthority(desired, current.revision))
        } catch (error) {
          const latest = requiredSnapshot(await this.nativeBridge.loadAuthority())
          this.revision = latest.revision
          if (error && typeof error === 'object' && 'kind' in error && error.kind === 'revision-conflict') return { status: 'STALE_PROGRAM', message: 'Final CAS conflict; refresh/review before another save' }
          return latest.revision === current.revision
            ? { status: 'PERSISTENCE_FAILED', message: 'Program write failed without durable revision change' }
            : { status: 'INDETERMINATE', message: 'Write acknowledgement uncertain; do not retry automatically' }
        }
        this.verifyExpected(desired, saved.data, 'program save')
        this.revision = saved.revision
        return { status: 'APPLIED', data: saved.data, resultingRevision: saved.revision }
      } catch { return { status: attempted ? 'INDETERMINATE' : 'PERSISTENCE_FAILED', message: 'Authority unavailable; refresh before another save' } }
    })
  }

  changeTemplateRepRange(plan: TemplateRepRangePlan): Promise<TrackingMutationResult> {
    const confirmed = structuredClone(plan)
    return this.enqueue(async () => {
      if (!this.supportsConfirmedTrackingMutations) return { status: 'BLOCKED', message: 'Safe authoritative storage is required' }
      let writeAttempted = false
      try {
        const current = requiredSnapshot(await this.nativeBridge.loadAuthority())
        this.revision = current.revision
        let desired: AppData
        try { desired = applyRepRange(current.data, confirmed) }
        catch { return { status: 'STALE', message: 'Target changed or is no longer valid; create a new preview' } }
        let saved: { data: AppData; revision: number }
        try {
          writeAttempted = true
          saved = requiredSnapshot(await this.nativeBridge.replaceAuthority(desired, current.revision))
        } catch (error) {
          // CAS can lose a race to Sync Service even inside the Desktop queue.
          const latest = requiredSnapshot(await this.nativeBridge.loadAuthority())
          this.revision = latest.revision
          const conflict = !!error && typeof error === 'object' && 'kind' in error && error.kind === 'revision-conflict'
          return conflict
            ? { status: 'STALE', message: 'Authority changed during execution; refresh and preview again' }
            : latest.revision === current.revision
              ? { status: 'FAILED', message: 'Persistence failed without changing authoritative revision' }
              : { status: 'INDETERMINATE', message: 'Write acknowledgement lost and authority changed. Inspect refreshed state; do not replay this confirmation' }
        }
        this.verifyExpected(desired, saved.data, 'confirmed template rep range')
        this.revision = saved.revision
        return { status: 'APPLIED', data: saved.data, receipt: {
          action: confirmed.action, templateId: confirmed.templateId, templateExerciseId: confirmed.templateExerciseId,
          exerciseId: confirmed.exerciseId, beforePrescription: confirmed.beforePrescription,
          afterPrescription: confirmed.afterPrescription, appliedAt: new Date().toISOString(), resultingRevision: saved.revision,
        } }
      } catch { return { status: writeAttempted ? 'INDETERMINATE' : 'FAILED', message: 'Unable to verify authoritative persistence; refresh before retrying' } }
    })
  }

  private verifyExpected(expected: AppData, actual: AppData, operation: string) {
    const difference = semanticJsonDifference(jsonBoundaryValue(expected), jsonBoundaryValue(actual))
    if (difference) throw new Error(`Native SQLite authority differs during ${operation} at ${difference}`)
  }

  private async initialize(): Promise<AppData> {
    const status = requiredStatus(await this.nativeBridge.authorityStatus())
    if (!status.bootstrapped) {
      const legacy = await this.legacy.loadForAuthorityMigration()
      try {
        const response = await this.nativeBridge.bootstrapAuthority(legacy)
        const snapshot = requiredSnapshot(response)
        this.verifyExpected(legacy, snapshot.data, 'legacy bootstrap')
        if (!response.backupPath) {
          throw new Error('Native SQLite bootstrap did not return its verified pre-migration backup.')
        }
        this.revision = snapshot.revision
        return snapshot.data
      } catch (error) {
        if (!this.options.fallbackToLegacyOnBootstrapFailure) throw error
        this.legacyFallback = true
        return legacy
      }
    }
    const snapshot = requiredSnapshot(await this.nativeBridge.loadAuthority())
    this.revision = snapshot.revision
    return snapshot.data
  }

  private ensureInitialized() {
    this.initialization ??= this.initialize().catch((error) => {
      this.initialization = undefined
      throw error
    })
    return this.initialization
  }

  async load(): Promise<AppData> {
    return this.enqueue(async () => {
    if (this.revision === undefined) {
      const initialized = await this.ensureInitialized()
      return this.legacyFallback ? this.legacy.load() : structuredClone(initialized)
    }
    const snapshot = requiredSnapshot(await this.nativeBridge.loadAuthority())
    this.revision = snapshot.revision
    return snapshot.data
    })
  }

  save(data: AppData): Promise<void> {
    const desired = structuredClone(data)
    return this.enqueue(async () => {
      await this.ensureInitialized()
      if (this.legacyFallback) {
        await this.legacy.save(desired)
        return
      }
      if (this.revision === undefined) throw new Error('Native SQLite authority revision is unavailable.')
      const snapshot = requiredSnapshot(
        await this.nativeBridge.replaceAuthority(desired, this.revision),
      )
      this.verifyExpected(desired, snapshot.data, 'desktop write')
      this.revision = snapshot.revision
    })
  }

  backupBeforeImport(data: AppData): Promise<void> {
    const expected = structuredClone(data)
    return this.enqueue(async () => {
      await this.ensureInitialized()
      if (this.legacyFallback) {
        await this.legacy.backupBeforeImport(expected)
        return
      }
      const response = await this.nativeBridge.backupAuthorityBeforeImport(expected)
      const snapshot = requiredSnapshot(response)
      this.verifyExpected(expected, snapshot.data, 'pre-import backup')
      if (!response.backupPath) {
        throw new Error('Native SQLite authority did not return its verified backup path.')
      }
      this.revision = snapshot.revision
    })
  }

  async loadIfChanged(): Promise<AppData | undefined> {
    return this.enqueue(async () => {
    await this.ensureInitialized()
    if (this.legacyFallback) return undefined
    const status = requiredStatus(await this.nativeBridge.authorityStatus())
    if (status.globalRevision === this.revision) return undefined
    const snapshot = requiredSnapshot(await this.nativeBridge.loadAuthority())
    this.revision = snapshot.revision
    return snapshot.data
    })
  }
}

export class ProductionSafeAuthoritativeAppDataStore extends DevelopmentAuthoritativeAppDataStore {
  constructor(legacy: LegacyAuthorityMigrationSource, nativeBridge: NativeAuthorityBridge) {
    super(legacy, nativeBridge, { fallbackToLegacyOnBootstrapFailure: true })
  }
}
