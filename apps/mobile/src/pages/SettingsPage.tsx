import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CloudOff, Database, Link2, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useMobileData } from '../context/MobileDataContext'
import { NativeMobileStore, type PairingCode, type SyncOverview } from '../services/mobileStore'
import { decodePairingQrImage, pairingPanelVisible, validatePairingCode } from '../services/pairingFlow'
import { syncLabelForTransmittable } from '../services/syncStatus'

type SyncLabel = 'Synced' | 'Changes waiting' | 'PC unavailable' | 'Offline' | 'Sync failed — data safe locally'

const commandKind = (cause: unknown) => typeof cause === 'object' && cause !== null && 'kind' in cause
  ? String((cause as { kind: unknown }).kind)
  : ''

export const SettingsPage = ({ openHistory }: { openHistory: () => void }) => {
  const { snapshot, isNative, reload } = useMobileData()
  const nativeStore = useMemo(() => isNative ? new NativeMobileStore() : undefined, [isNative])
  const [overview, setOverview] = useState<SyncOverview>()
  const [pairingCode, setPairingCode] = useState('')
  const [syncLabel, setSyncLabel] = useState<SyncLabel>('Synced')
  const [busy, setBusy] = useState(false)
  const [pairingError, setPairingError] = useState<string>()
  const [replacing, setReplacing] = useState(false)
  const qrInput = useRef<HTMLInputElement>(null)

  const refreshOverview = async () => {
    if (!nativeStore) return
    const next = await nativeStore.syncOverview()
    setOverview(next)
    setSyncLabel(syncLabelForTransmittable(next.transmittablePendingChanges))
  }

  useEffect(() => { void refreshOverview().catch(() => setSyncLabel('Sync failed — data safe locally')) }, [nativeStore])
  if (!snapshot) return null
  const remote = overview?.remotes[0]

  const pair = async (scannedPairing?: PairingCode) => {
    if (!nativeStore) return
    setBusy(true)
    setPairingError(undefined)
    try {
      const pairing = scannedPairing ?? validatePairingCode(pairingCode.trim())
      await nativeStore.pair(pairing, remote?.serviceId)
      setPairingCode('')
      setReplacing(false)
      await refreshOverview()
    } catch (cause) {
      setPairingError(cause instanceof Error ? cause.message : 'Parowanie nie powiodło się.')
    } finally {
      setBusy(false)
    }
  }

  const scanQr = async (file?: File) => {
    if (!file) return
    setPairingError(undefined)
    try {
      const decoded = await decodePairingQrImage(file)
      const pairing = validatePairingCode(decoded)
      setPairingCode(decoded)
      await pair(pairing)
    } catch (cause) {
      setPairingError(cause instanceof Error ? cause.message : 'Nie udało się odczytać kodu QR.')
    } finally {
      if (qrInput.current) qrInput.current.value = ''
    }
  }

  const syncNow = async () => {
    if (!nativeStore) return
    setBusy(true)
    try {
      const response = await nativeStore.syncNow(remote?.serviceId)
      setSyncLabel(syncLabelForTransmittable(response.report.pendingChanges))
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
      <section className="surface settings-section"><div className="settings-icon"><ShieldCheck /></div><div><strong>Oczekujące zmiany</strong><p>{overview?.transmittablePendingChanges ?? 0} operacji czeka na wysłanie.</p>{(overview?.reviewChanges ?? 0) > 0 && <p>{overview?.reviewChanges} starsze zmiany dziennika wymagają przeglądu.</p>}</div></section>
      <section className="surface sync-card">
        <div className="sync-heading"><div className="settings-icon"><Link2 /></div><div><strong>Synchronizacja z PC</strong><p className={`sync-state ${syncLabel === 'Synced' ? 'ok' : ''}`}>{syncLabel}</p></div></div>
        {remote && <><p className="paired-host">Połączono z <strong>PC</strong></p><div className="sync-actions"><button className="primary-button" type="button" disabled={busy || replacing} onClick={() => void syncNow()}>{busy ? 'Synchronizuję…' : 'Synchronizuj teraz'}</button><button className="secondary-button" type="button" disabled={busy} onClick={() => { setReplacing(true); setPairingError(undefined) }}>Zmień połączenie</button></div></>}
        {pairingPanelVisible(Boolean(remote), replacing) && <div className="pairing-form">
          {remote && <div className="pairing-replace-heading"><strong>Połącz z innym komputerem</strong><button className="icon-button" type="button" disabled={busy} aria-label="Anuluj zmianę połączenia" onClick={() => { setReplacing(false); setPairingCode(''); setPairingError(undefined) }}><X size={18} /></button></div>}
          <input ref={qrInput} className="qr-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => void scanQr(event.target.files?.[0])} />
          <button className="secondary-button" type="button" disabled={!isNative || busy} onClick={() => qrInput.current?.click()}><Camera size={18} /> {busy ? 'Paruję…' : 'Skanuj kod QR'}</button>
          <label className="mobile-field full"><span>Kod parowania z PC</span><textarea rows={5} value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} placeholder='Wklej kod JSON wygenerowany na komputerze' /></label>
          {pairingError && <p className="pairing-error">{pairingError}</p>}
          <button className="primary-button" type="button" disabled={!isNative || busy || !pairingCode.trim()} onClick={() => void pair()}>{busy ? 'Paruję…' : 'Połącz z PC'}</button>
          {remote && <p className="safe-copy">Dotychczasowe połączenie i dane pozostaną bez zmian, jeśli anulujesz albo parowanie się nie powiedzie.</p>}
          {!isNative && <p className="safe-copy">Parowanie jest dostępne w aplikacji Android.</p>}
        </div>}
      </section>
      <button className="secondary-button settings-action" type="button" onClick={() => void reload()}><RefreshCw size={18} /> Odśwież dane lokalne</button>
      <button className="secondary-button settings-action" type="button" onClick={openHistory}>Otwórz Historię</button><p className="device-id">{snapshot.deviceId}</p>
    </main>
  )
}
