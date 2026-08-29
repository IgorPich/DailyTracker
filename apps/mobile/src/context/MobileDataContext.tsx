import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppData } from '@greekgod/core'
import { INITIAL_MOBILE_DATA } from '../data/initialData'
import { NativeMobileStore, type MobileSnapshot, type MobileStore } from '../services/mobileStore'

interface MobileDataValue {
  snapshot?: MobileSnapshot
  data?: AppData
  loading: boolean
  saving: boolean
  error?: string
  isNative: boolean
  mutate(updater: (data: AppData) => AppData): Promise<MobileSnapshot>
  reload(): Promise<void>
}

const MobileDataContext = createContext<MobileDataValue | undefined>(undefined)

class PreviewMobileStore implements MobileStore {
  private snapshot: MobileSnapshot = {
    data: structuredClone(INITIAL_MOBILE_DATA),
    revision: 0,
    appliedOperations: 0,
    pendingChanges: 0,
    deviceId: 'mobile:browser-preview',
    probe: {
      databasePath: 'browser-preview-only',
      sqliteVersion: 'preview',
      schemaVersion: 7,
      journalMode: 'memory',
    },
  }

  async initialize() { return structuredClone(this.snapshot) }
  async load() { return structuredClone(this.snapshot) }
  async save(data: AppData, expectedRevision: number) {
    if (expectedRevision !== this.snapshot.revision) throw new Error('Nieaktualna wersja danych podglądu.')
    this.snapshot = {
      ...this.snapshot,
      data: structuredClone(data),
      revision: expectedRevision + 1,
      appliedOperations: 1,
      pendingChanges: this.snapshot.pendingChanges + 1,
    }
    return structuredClone(this.snapshot)
  }
}

const nativeRuntime = () => '__TAURI_INTERNALS__' in window
const errorKind = (cause: unknown) => typeof cause === 'object' && cause !== null && 'kind' in cause
  ? String((cause as { kind: unknown }).kind)
  : ''

export const MobileDataProvider = ({ children }: { children: ReactNode }) => {
  const isNative = nativeRuntime()
  const store = useMemo<MobileStore>(() => isNative ? new NativeMobileStore() : new PreviewMobileStore(), [isNative])
  const [snapshot, setSnapshot] = useState<MobileSnapshot>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const snapshotRef = useRef<MobileSnapshot>()
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  const install = (next: MobileSnapshot) => {
    snapshotRef.current = next
    setSnapshot(next)
    setError(undefined)
    return next
  }

  const reload = async () => {
    const operation = queueRef.current.then(async () => {
      try {
        install(await store.load())
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })
    queueRef.current = operation.catch(() => undefined)
    await operation
  }

  useEffect(() => {
    let cancelled = false
    store.initialize(structuredClone(INITIAL_MOBILE_DATA))
      .then((next) => { if (!cancelled) install(next) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [store])

  useEffect(() => {
    if (!isNative) return
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void reload() }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [isNative, store])

  const mutate = (updater: (data: AppData) => AppData) => {
    const operation = queueRef.current.then(async () => {
      const current = snapshotRef.current
      if (!current) throw new Error('Mobilna baza nie jest jeszcze gotowa.')
      setSaving(true)
      try {
        const desired = updater(structuredClone(current.data))
        try {
          return install(await store.save(desired, current.revision))
        } catch (cause) {
          if (errorKind(cause) !== 'revision-conflict') throw cause
          const fresh = install(await store.load())
          return install(await store.save(updater(structuredClone(fresh.data)), fresh.revision))
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setError(message)
        throw cause
      } finally {
        setSaving(false)
      }
    })
    queueRef.current = operation.catch(() => undefined)
    return operation
  }

  return (
    <MobileDataContext.Provider value={{
      snapshot,
      data: snapshot?.data,
      loading,
      saving,
      error,
      isNative,
      mutate,
      reload,
    }}>
      {children}
    </MobileDataContext.Provider>
  )
}

export const useMobileData = () => {
  const value = useContext(MobileDataContext)
  if (!value) throw new Error('useMobileData requires MobileDataProvider')
  return value
}
