import type { AppData } from '@greekgod/core'
import { invoke } from '@tauri-apps/api/core'

export interface MobileSnapshot {
  data: AppData
  revision: number
  appliedOperations: number
  pendingChanges: number
  deviceId: string
  probe: {
    databasePath: string
    sqliteVersion: string
    schemaVersion: number
    journalMode: string
  }
}

export interface MobileStore {
  initialize(initialData: AppData): Promise<MobileSnapshot>
  load(): Promise<MobileSnapshot>
  save(data: AppData, expectedRevision: number): Promise<MobileSnapshot>
}

export interface PairingCode {
  baseUrl: string
  serviceId: string
  certificateFingerprintSha256: string
  nonce: string
  expiresAtEpoch?: number
}

export interface SyncRemote {
  serviceId: string
  certificateFingerprintSha256: string
  lastKnownHost: string
  lastPulledRevision: number
}

export interface SyncOverview {
  remotes: SyncRemote[]
  pendingChanges: number
  dailyConflicts: Array<{ serviceId: string; operationId: string; date: string; status: string; originalRemoteBase: number | null; authorityRevision: number | null; payload: unknown }>
}

export interface SyncNowResponse {
  report: {
    serverRevision: number
    pushedOperations: number
    pulledChanges: number
    conflictsResolved: number
    pendingChanges: number
  }
  snapshot: MobileSnapshot
}

export interface TimerStartRequest {
  workoutId: string
  exerciseId: string
  setId: string
  templateLabel: string
  exerciseLabel: string
  previousLabel: string
  durationSeconds: number
}

export interface TimerStatus {
  state: 'idle' | 'running' | 'finished'
  targetEpochMs?: number
  durationSeconds?: number
}

export class NativeMobileStore implements MobileStore {
  initialize(initialData: AppData) {
    return invoke<MobileSnapshot>('mobile_storage_initialize', { initialData })
  }

  load() {
    return invoke<MobileSnapshot>('mobile_storage_load')
  }

  save(data: AppData, expectedRevision: number) {
    return invoke<MobileSnapshot>('mobile_storage_replace', { data, expectedRevision })
  }

  syncOverview() {
    return invoke<SyncOverview>('mobile_sync_overview')
  }

  pair(pairing: PairingCode) {
    return invoke<{ serviceId: string; lastKnownHost: string; pendingChanges: number }>(
      'mobile_pair',
      { pairing },
    )
  }

  syncNow(serviceId?: string) {
    return invoke<SyncNowResponse>('mobile_sync_now', { selection: { serviceId } })
  }

  startTimer(request: TimerStartRequest) {
    return invoke<TimerStatus>('mobile_timer_start', { request })
  }

  timerStatus() {
    return invoke<TimerStatus>('mobile_timer_status')
  }
}
