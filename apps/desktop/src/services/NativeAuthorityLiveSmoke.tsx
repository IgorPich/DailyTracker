import { invoke } from '@tauri-apps/api/core'
import { load } from '@tauri-apps/plugin-store'
import { useEffect, useRef, useState } from 'react'
import type { AppData } from '@greekgod/core'
import { appDataStore } from './appDataStore'
import { smokeFixture } from './NativeSqliteWebViewSmoke'
import { tauriNativeStorageBridge } from './tauriNativeStorageBridge'

const RESULT_FILE = 'authority-live-result.json'
const READY_FILE = 'authority-live-ready.json'
const DESKTOP_EDIT_ACK_FILE = 'authority-live-desktop-edit-ack.json'

const writeDocument = async (filename: string, value: Record<string, unknown>) => {
  const store = await load(filename, { autoSave: false })
  await store.set('result', value)
  await store.save()
}

const statusRevision = async () => {
  const response = await tauriNativeStorageBridge.authorityStatus()
  if (!response.enabled || !response.status?.bootstrapped) {
    throw new Error('Shared authority status is unavailable.')
  }
  if (response.status.globalRevision !== response.status.materializedRevision) {
    throw new Error('Shared authority mirror revision is stale.')
  }
  return response.status.globalRevision
}

const waitForServiceSequence = async (initial: AppData) => {
  let current = initial
  let desktopEditCommitted = false
  const deadline = Date.now() + 35_000
  while (Date.now() < deadline) {
    const changed = await appDataStore.loadIfChanged?.()
    if (changed) current = changed
    const serviceWorkout = current.workouts.find((workout) => workout.id === 'live-service-workout')
    if (serviceWorkout && !desktopEditCommitted) {
      const next = structuredClone(current)
      const desktopWorkout = next.workouts.find((workout) => workout.id === 'sqlite-smoke-workout')
      if (!desktopWorkout) throw new Error('Desktop smoke workout disappeared.')
      desktopWorkout.duration = 73.25
      await appDataStore.save(next)
      current = await appDataStore.load()
      desktopEditCommitted = true
      await writeDocument(DESKTOP_EDIT_ACK_FILE, {
        status: 'desktop-edit-committed',
        revision: await statusRevision(),
      })
    }
    if (desktopEditCommitted && !serviceWorkout) return current
    await new Promise((resolve) => window.setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for the live Service create/tombstone sequence.')
}

const runSmoke = async () => {
  const loaded = await appDataStore.load()
  const closedWorkout = loaded.workouts.find((workout) => workout.id === 'live-closed-workout')
  if (closedWorkout) {
    if (closedWorkout.note !== 'Committed while Desktop was closed') {
      throw new Error('Closed-Desktop service payload drifted.')
    }
    return {
      status: 'pass',
      phase: 'reopen',
      revision: await statusRevision(),
      closedWorkoutSeen: true,
    }
  }

  const baseline = smokeFixture()
  await appDataStore.save(baseline)
  const desktopDailyEdit = await appDataStore.load()
  desktopDailyEdit.dailyEntries[0].weight = 83.15
  await appDataStore.save(desktopDailyEdit)
  const probe = await tauriNativeStorageBridge.probe()
  if (!probe.probe) throw new Error('Shared authority probe is missing.')
  await writeDocument(READY_FILE, {
    status: 'ready',
    revision: await statusRevision(),
    databasePath: probe.probe.databasePath,
  })

  const finalData = await waitForServiceSequence(await appDataStore.load())
  const daily = finalData.dailyEntries.find((entry) => entry.date === '2026-08-26')
  const desktopWorkout = finalData.workouts.find((workout) => workout.id === 'sqlite-smoke-workout')
  if (daily?.weight !== 83.15) throw new Error('Desktop DailyEntry edit was lost.')
  if (desktopWorkout?.duration !== 73.25) throw new Error('Desktop Workout edit was lost.')
  if (finalData.workouts.some((workout) => workout.id === 'live-service-workout')) {
    throw new Error('Service tombstone resurrected in the Desktop view.')
  }
  return {
    status: 'pass',
    phase: 'open',
    revision: await statusRevision(),
    dailyEntryPreserved: true,
    desktopWorkoutPreserved: true,
    serviceTombstoneObserved: true,
  }
}

export function NativeAuthorityLiveSmoke() {
  const started = useRef(false)
  const [status, setStatus] = useState('Uruchamianie live Desktop + Service smoke…')

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const result = await runSmoke()
        await writeDocument(RESULT_FILE, { ...result, completedAt: new Date().toISOString() })
        setStatus(`AUTHORITY_LIVE_SMOKE_PASS: ${result.phase}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await writeDocument(RESULT_FILE, {
          status: 'fail',
          message,
          completedAt: new Date().toISOString(),
        })
        setStatus(`AUTHORITY_LIVE_SMOKE_FAIL: ${message}`)
      } finally {
        await invoke('native_sqlite_smoke_exit')
      }
    })()
  }, [])

  return <main style={{ color: '#fff', background: '#0a0a0b', minHeight: '100vh', padding: 32 }}>{status}</main>
}
