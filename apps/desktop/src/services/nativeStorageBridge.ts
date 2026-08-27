import type { AppData, AppDataStore } from '@greekgod/core'

export interface NativeStorageProbe {
  databasePath: string
  sqliteVersion: string
  schemaVersion: number
  journalMode: string
}

export interface NativeStorageProbeResponse {
  enabled: boolean
  probe?: NativeStorageProbe
}

export interface NativeShadowResponse extends NativeStorageProbeResponse {
  data?: unknown
  backupPath?: string
}

export interface NativeStorageBridge {
  probe(): Promise<NativeStorageProbeResponse>
  replaceShadow(data: AppData): Promise<NativeShadowResponse>
  loadShadow(): Promise<NativeShadowResponse>
  backupShadowBeforeImport(data: AppData): Promise<NativeShadowResponse>
}

export const jsonBoundaryValue = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown

export const semanticJsonDifference = (
  expected: unknown,
  actual: unknown,
  path = '$',
): string | undefined => {
  if (Object.is(expected, actual)) return undefined
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return `${path}: array/type mismatch`
    if (expected.length !== actual.length) return `${path}: array length ${expected.length} != ${actual.length}`
    for (let index = 0; index < expected.length; index += 1) {
      const difference = semanticJsonDifference(expected[index], actual[index], `${path}[${index}]`)
      if (difference) return difference
    }
    return undefined
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const expectedRecord = expected as Record<string, unknown>
    const actualRecord = actual as Record<string, unknown>
    const expectedKeys = Object.keys(expectedRecord).sort()
    const actualKeys = Object.keys(actualRecord).sort()
    if (expectedKeys.length !== actualKeys.length || expectedKeys.some((key, index) => key !== actualKeys[index])) {
      return `${path}: object keys ${JSON.stringify(expectedKeys)} != ${JSON.stringify(actualKeys)}`
    }
    for (const key of expectedKeys) {
      const difference = semanticJsonDifference(expectedRecord[key], actualRecord[key], `${path}.${key}`)
      if (difference) return difference
    }
    return undefined
  }
  return `${path}: ${JSON.stringify(expected)} != ${JSON.stringify(actual)}`
}

export class DevelopmentShadowAppDataStore implements AppDataStore {
  private enabledPromise: Promise<boolean> | undefined

  constructor(
    private readonly legacy: AppDataStore,
    private readonly nativeBridge: NativeStorageBridge,
  ) {}

  private enabled() {
    this.enabledPromise ??= this.nativeBridge.probe().then((response) => response.enabled)
    return this.enabledPromise
  }

  private verifyResponse(data: AppData, response: NativeShadowResponse, operation: string) {
    if (!response.enabled || response.data === undefined) {
      throw new Error(`Native SQLite shadow became unavailable during ${operation}.`)
    }
    const expected = jsonBoundaryValue(data)
    const difference = semanticJsonDifference(expected, response.data)
    if (difference) throw new Error(`Native SQLite shadow differs from Legacy Store at ${difference}`)
  }

  private async mirrorAndVerify(data: AppData) {
    if (!await this.enabled()) return
    this.verifyResponse(data, await this.nativeBridge.replaceShadow(data), 'write')
    this.verifyResponse(data, await this.nativeBridge.loadShadow(), 'reopen/load')
  }

  async load(): Promise<AppData> {
    const data = await this.legacy.load()
    await this.mirrorAndVerify(data)
    return data
  }

  async save(data: AppData): Promise<void> {
    await this.legacy.save(data)
    await this.mirrorAndVerify(data)
  }

  async backupBeforeImport(data: AppData): Promise<void> {
    await this.legacy.backupBeforeImport(data)
    if (!await this.enabled()) return
    const response = await this.nativeBridge.backupShadowBeforeImport(data)
    this.verifyResponse(data, response, 'online backup verification')
    if (!response.backupPath) throw new Error('Native SQLite backup did not return its verified path.')
  }
}
