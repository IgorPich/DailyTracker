import { invoke } from '@tauri-apps/api/core'
import { load } from '@tauri-apps/plugin-store'
import { useEffect, useRef, useState } from 'react'
import type { AppData } from '@greekgod/core'
import { createInitialData } from '../utils/storage'
import { semanticJsonDifference } from './nativeStorageBridge'
import { tauriNativeStorageBridge } from './tauriNativeStorageBridge'

const RESULT_FILE = 'sqlite-smoke-result.json'

const smokeFixture = (): AppData => {
  const initial = createInitialData()
  const template = initial.templates[0]
  const exercise = template.exercises[0]
  return {
    ...initial,
    dailyEntries: [{
      id: 'sqlite-smoke-daily',
      date: '2026-08-26',
      weight: 82.35,
      calories: 3125,
      protein: 187.5,
      fat: 61.25,
      carbs: 312.75,
      steps: 12345,
      waist: 79.8,
      sleep: 7.25,
      recovery: 8.5,
      note: 'SQLite WebView smoke: ążźć',
    }],
    workouts: [{
      id: 'sqlite-smoke-workout',
      date: '2026-08-26',
      templateId: template.id,
      templateCode: template.code,
      templateName: template.name,
      duration: 67.5,
      gymLocation: 'SQLite Smoke Gym',
      note: '',
      exercises: [{
        id: 'sqlite-smoke-exercise',
        exerciseId: exercise.exerciseId,
        name: exercise.name,
        prescription: exercise.prescription,
        equipmentSensitive: exercise.equipmentSensitive,
        sets: [
          { id: 'sqlite-smoke-set-z', weight: 91.25, reps: 5, rir: 1.5 },
          { id: 'sqlite-smoke-set-a', reps: 9 },
        ],
      }],
    }],
    settings: {
      ...initial.settings,
      phase: 'Lean Gain',
      calorieTarget: 3125,
      proteinTarget: 187.5,
      weightTarget: 84.25,
      gymLocations: ['SQLite Smoke Gym'],
      lastGymLocation: 'SQLite Smoke Gym',
    },
    coachNotes: { '2026-08-smoke': 'Pełna ścieżka React → Tauri → Rust → SQLite.' },
  }
}

const assertSemanticEquality = (expected: AppData, actual: unknown, operation: string) => {
  const difference = semanticJsonDifference(
    JSON.parse(JSON.stringify(expected)) as unknown,
    actual,
  )
  if (difference) throw new Error(`${operation} differs at ${difference}`)
}

const writeResult = async (result: Record<string, unknown>) => {
  const store = await load(RESULT_FILE, { autoSave: false })
  await store.set('result', result)
  await store.save()
}

const errorDetails = (error: unknown) => {
  if (error && typeof error === 'object') {
    const candidate = error as { kind?: unknown; message?: unknown }
    return {
      kind: typeof candidate.kind === 'string' ? candidate.kind : 'webview-smoke-failed',
      message: typeof candidate.message === 'string' ? candidate.message : JSON.stringify(error),
    }
  }
  return { kind: 'webview-smoke-failed', message: String(error) }
}

const runSmoke = async () => {
  const fixture = smokeFixture()
  const probe = await tauriNativeStorageBridge.probe()
  if (!probe.enabled || !probe.probe) throw new Error('Native SQLite probe is not enabled.')

  const replaced = await tauriNativeStorageBridge.replaceShadow(fixture)
  assertSemanticEquality(fixture, replaced.data, 'write/read-back')

  const loaded = await tauriNativeStorageBridge.loadShadow()
  assertSemanticEquality(fixture, loaded.data, 'reopen/load')

  const freshBackup = await tauriNativeStorageBridge.backupShadowBeforeImport(fixture)
  assertSemanticEquality(fixture, freshBackup.data, 'fresh backup')
  if (!freshBackup.backupPath) throw new Error('Fresh backup path is missing.')

  const existingBackup = await tauriNativeStorageBridge.backupShadowBeforeImport(fixture)
  assertSemanticEquality(fixture, existingBackup.data, 'existing backup')
  if (existingBackup.backupPath !== freshBackup.backupPath) {
    throw new Error('Existing backup did not reuse the verified content-addressed backup.')
  }

  return {
    status: 'pass',
    completedAt: new Date().toISOString(),
    sqliteVersion: probe.probe.sqliteVersion,
    schemaVersion: probe.probe.schemaVersion,
    journalMode: probe.probe.journalMode,
    databasePath: probe.probe.databasePath,
    backupPath: freshBackup.backupPath,
  }
}

export function NativeSqliteWebViewSmoke() {
  const started = useRef(false)
  const [status, setStatus] = useState('Uruchamianie kontrolowanego smoke SQLite…')

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const result = await runSmoke()
        await writeResult(result)
        setStatus('SQLITE_WEBVIEW_SMOKE_PASS')
      } catch (error) {
        const details = errorDetails(error)
        await writeResult({ status: 'fail', completedAt: new Date().toISOString(), ...details })
        setStatus(`SQLITE_WEBVIEW_SMOKE_FAIL: ${details.kind}`)
      } finally {
        await invoke('native_sqlite_smoke_exit')
      }
    })()
  }, [])

  return <main style={{ color: '#fff', background: '#0a0a0b', minHeight: '100vh', padding: 32 }}>{status}</main>
}
