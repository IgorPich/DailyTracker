import { invoke } from '@tauri-apps/api/core'
import { load } from '@tauri-apps/plugin-store'
import { useEffect, useRef, useState } from 'react'
import { appDataStore } from './appDataStore'
import { semanticJsonDifference } from './nativeStorageBridge'
import { smokeFixture } from './NativeSqliteWebViewSmoke'
import { tauriNativeStorageBridge } from './tauriNativeStorageBridge'

const RESULT_FILE = 'authority-smoke-result.json'

const assertSemanticEquality = (expected: unknown, actual: unknown, operation: string) => {
  const difference = semanticJsonDifference(
    JSON.parse(JSON.stringify(expected)) as unknown,
    JSON.parse(JSON.stringify(actual)) as unknown,
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
      kind: typeof candidate.kind === 'string' ? candidate.kind : 'authority-smoke-failed',
      message: typeof candidate.message === 'string' ? candidate.message : JSON.stringify(error),
    }
  }
  return { kind: 'authority-smoke-failed', message: String(error) }
}

const runSmoke = async () => {
  const probe = await tauriNativeStorageBridge.probe()
  if (!probe.enabled || !probe.probe) throw new Error('Native SQLite probe is not enabled.')

  await appDataStore.load()
  const afterBootstrap = await tauriNativeStorageBridge.authorityStatus()
  if (!afterBootstrap.enabled || !afterBootstrap.status?.bootstrapped) {
    throw new Error('Native authority was not bootstrapped through the desktop AppDataStore.')
  }

  const fixture = smokeFixture()
  await appDataStore.save(fixture)
  const loaded = await appDataStore.load()
  assertSemanticEquality(fixture, loaded, 'authority save/reopen')

  await appDataStore.backupBeforeImport(loaded)
  const backup = await tauriNativeStorageBridge.backupAuthorityBeforeImport(loaded)
  assertSemanticEquality(loaded, backup.data, 'verified authority backup')
  if (!backup.backupPath) throw new Error('Verified authority backup path is missing.')

  const unchanged = await appDataStore.loadIfChanged?.()
  if (unchanged !== undefined) throw new Error('Revision polling reported a change without a commit.')
  const status = await tauriNativeStorageBridge.authorityStatus()
  if (!status.status || status.status.globalRevision !== status.status.materializedRevision) {
    throw new Error('Materialized revision does not match authoritative revision.')
  }

  return {
    status: 'pass',
    completedAt: new Date().toISOString(),
    sqliteVersion: probe.probe.sqliteVersion,
    schemaVersion: probe.probe.schemaVersion,
    journalMode: probe.probe.journalMode,
    databasePath: probe.probe.databasePath,
    backupPath: backup.backupPath,
    revision: status.status.globalRevision,
  }
}

export function NativeAuthorityWebViewSmoke() {
  const started = useRef(false)
  const [status, setStatus] = useState('Uruchamianie kontrolowanego smoke authority SQLite…')

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const result = await runSmoke()
        await writeResult(result)
        setStatus('SQLITE_AUTHORITY_SMOKE_PASS')
      } catch (error) {
        const details = errorDetails(error)
        await writeResult({ status: 'fail', completedAt: new Date().toISOString(), ...details })
        setStatus(`SQLITE_AUTHORITY_SMOKE_FAIL: ${details.kind}`)
      } finally {
        await invoke('native_sqlite_smoke_exit')
      }
    })()
  }, [])

  return <main style={{ color: '#fff', background: '#0a0a0b', minHeight: '100vh', padding: 32 }}>{status}</main>
}
