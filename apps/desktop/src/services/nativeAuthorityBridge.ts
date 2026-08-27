import type { AppData, AppDataStore } from '@greekgod/core'
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

export class DevelopmentAuthoritativeAppDataStore implements AppDataStore {
  private revision: number | undefined
  private initialization: Promise<AppData> | undefined
  private saveQueue: Promise<void> = Promise.resolve()
  private legacyFallback = false

  constructor(
    private readonly legacy: LegacyAuthorityMigrationSource,
    private readonly nativeBridge: NativeAuthorityBridge,
    private readonly options: { fallbackToLegacyOnBootstrapFailure?: boolean } = {},
  ) {}

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
    await this.saveQueue.catch(() => undefined)
    if (this.revision === undefined) {
      const initialized = await this.ensureInitialized()
      return this.legacyFallback ? this.legacy.load() : structuredClone(initialized)
    }
    const snapshot = requiredSnapshot(await this.nativeBridge.loadAuthority())
    this.revision = snapshot.revision
    return snapshot.data
  }

  save(data: AppData): Promise<void> {
    const desired = structuredClone(data)
    const operation = this.saveQueue.catch(() => undefined).then(async () => {
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
    this.saveQueue = operation
    return operation
  }

  backupBeforeImport(data: AppData): Promise<void> {
    const expected = structuredClone(data)
    const operation = this.saveQueue.catch(() => undefined).then(async () => {
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
    this.saveQueue = operation
    return operation
  }

  async loadIfChanged(): Promise<AppData | undefined> {
    await this.saveQueue.catch(() => undefined)
    await this.ensureInitialized()
    if (this.legacyFallback) return undefined
    const status = requiredStatus(await this.nativeBridge.authorityStatus())
    if (status.globalRevision === this.revision) return undefined
    const snapshot = requiredSnapshot(await this.nativeBridge.loadAuthority())
    this.revision = snapshot.revision
    return snapshot.data
  }
}

export class ProductionSafeAuthoritativeAppDataStore extends DevelopmentAuthoritativeAppDataStore {
  constructor(legacy: LegacyAuthorityMigrationSource, nativeBridge: NativeAuthorityBridge) {
    super(legacy, nativeBridge, { fallbackToLegacyOnBootstrapFailure: true })
  }
}
