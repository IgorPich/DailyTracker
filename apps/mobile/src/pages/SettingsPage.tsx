import { useEffect, useMemo, useState } from 'react'
import { CloudOff, Database, Link2, RefreshCw, ShieldCheck } from 'lucide-react'
import { useMobileData } from '../context/MobileDataContext'
import { NativeMobileStore, type PairingCode, type SyncOverview } from '../services/mobileStore'

type SyncLabel = 'Synced' | 'Changes waiting' | 'PC unavailable' | 'Offline' | 'Sync failed — data safe locally'

const commandKind = (cause: unknown) => typeof cause === 'object' && cause !== null && 'kind' in cause
  ? String((cause as { kind: unknown }).kind)
  : ''

const validatePairingCode = (raw: string): PairingCode => {
  const parsed = JSON.parse(raw) as Partial<PairingCode>
  if (!parsed.baseUrl?.startsWith('https://') || !parsed.serviceId || !parsed.nonce
    || !/^[a-f\d]{64}$/i.test(parsed.certificateFingerprintSha256 ?? '')) {
    throw new Error('Nieprawidłowy kod parowania.')
  }
  if (parsed.expiresAtEpoch && parsed.expiresAtEpoch <= Math.floor(Date.now() / 1000)) {
    throw new Error('Kod parowania wygasł. Wygeneruj nowy na PC.')
  }
  return parsed as PairingCode
}

export const SettingsPage = ({ openHistory }: { openHistory: () => void }) => {
  const { snapshot, isNative, reload } = useMobileData()
  const nativeStore = useMemo(() => isNative ? new NativeMobileStore() : undefined, [isNative])
  const [overview, setOverview] = useState<SyncOverview>()
  const [pairingCode, setPairingCode] = useState('')
  const [syncLabel, setSyncLabel] = useState<SyncLabel>('Synced')
  const [busy, setBusy] = useState(false)
  const [pairingError, setPairingError] = useState<string>()

  const refreshOverview = async () => {
    if (!nativeStore) return
    const next = await nativeStore.syncOverview()
    setOverview(next)
    setSyncLabel(next.pendingChanges > 0 ? 'Changes waiting' : 'Synced')
  }

  useEffect(() => { void refreshOverview().catch(() => setSyncLabel('Sync failed — data safe locally')) }, [nativeStore])
  if (!snapshot) return null
  const remote = overview?.remotes[0]

  const pair = async () => {
    if (!nativeStore) return
    setBusy(true)
    setPairingError(undefined)
    try {
      await nativeStore.pair(validatePairingCode(pairingCode.trim()))
      setPairingCode('')
      await refreshOverview()
    } catch (cause) {
      setPairingError(cause instanceof Error ? cause.message : 'Parowanie nie powiodło się.')
    } finally {
      setBusy(false)
    }
  }

  const syncNow = async () => {
    if (!nativeStore) return
    setBusy(true)
    try {
      const response = await nativeStore.syncNow(remote?.serviceId)
      setSyncLabel(response.report.pendingChanges > 0 ? 'Changes waiting' : 'Synced')
      await reload()
      await refreshOverview()
    } catch (cause) {
      const kind = commandKind(cause)
      setSyncLabel(kind === 'offline' ? 'Offline' : kind === 'pc_unavailable' ? 'PC unavailable' : 'Sync failed — data safe locally')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mobile-page"><p className="eyebrow">Urządzenie i dane</p><h1>Ustawienia</h1>
      <section className="surface settings-section"><div className="settings-icon"><CloudOff /></div><div><strong>Tryb lokalny</strong><p>Dane działają bez Internetu i bez konta.</p></div></section>
      <section className="surface settings-section"><div className="settings-icon"><Database /></div><div><strong>Mobilne SQLite</strong><p>{isNative ? `Schema ${snapshot.probe.schemaVersion} · ${snapshot.probe.journalMode}` : 'Podgląd przeglądarkowy — Android użyje SQLite'}</p></div></section>
      <section className="surface settings-section"><div className="settings-icon"><ShieldCheck /></div><div><strong>Oczekujące zmiany</strong><p>{snapshot.pendingChanges} operacji czeka bezpiecznie w outboxie.</p></div></section>
      <section className="surface sync-card">
        {!!overview?.dailyConflicts?.length && <div role="alert"><strong>Zmiany dziennika wymagają przeglądu</strong>
          <p>Nie zastosowano ich automatycznie. Po synchronizacji obowiązuje świeży stan PC. Aby ponowić zmianę, odśwież dane, otwórz wskazany dzień w Dzienniku i wpisz ją ręcznie — powstanie nowa operacja. Stara pozostaje zablokowana.</p>
          {overview.dailyConflicts.map((item) => <details key={`${item.serviceId}:${item.operationId}`}><summary>{item.date} — {item.status === 'legacy_needs_review' ? 'starsza zmiana bez potwierdzonego baseline' : 'konflikt'}</summary><pre>{JSON.stringify(item.payload, null, 2)}</pre></details>)}
        </div>}
        <div className="sync-heading"><div className="settings-icon"><Link2 /></div><div><strong>Synchronizacja z PC</strong><p className={`sync-state ${syncLabel === 'Synced' ? 'ok' : ''}`}>{syncLabel}</p></div></div>
        {remote ? <><p className="paired-host">Połączono z <strong>{remote.lastKnownHost}</strong></p><button className="primary-button" type="button" disabled={busy} onClick={() => void syncNow()}>{busy ? 'Synchronizuję…' : 'Synchronizuj teraz'}</button></> : <div className="pairing-form">
          <label className="mobile-field full"><span>Kod parowania z PC</span><textarea rows={5} value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} placeholder='Wklej kod JSON wygenerowany na komputerze' /></label>
          {pairingError && <p className="pairing-error">{pairingError}</p>}
          <button className="primary-button" type="button" disabled={!isNative || busy || !pairingCode.trim()} onClick={() => void pair()}>{busy ? 'Paruję…' : 'Połącz z PC'}</button>
          {!isNative && <p className="safe-copy">Parowanie jest dostępne w aplikacji Android.</p>}
        </div>}
      </section>
      <button className="secondary-button settings-action" type="button" onClick={() => void reload()}><RefreshCw size={18} /> Odśwież dane lokalne</button>
      <button className="secondary-button settings-action" type="button" onClick={openHistory}>Otwórz Historię</button><p className="device-id">{snapshot.deviceId}</p>
    </main>
  )
}
