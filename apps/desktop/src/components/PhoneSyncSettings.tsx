import { useEffect, useRef, useState } from 'react'
import { Copy, Link2, Smartphone, X } from 'lucide-react'
import { useToast } from '../context/ToastContext'
import {
  cancelDesktopPairing,
  getDesktopSyncStatus,
  openDesktopPairing,
  pairingPayloadJson,
  pairingQrDataUrl,
  pairingSecondsRemaining,
  type DesktopSyncStatus,
  type PairingBootstrap,
} from '../services/phoneSyncService'

type ServiceState = 'loading' | 'ready' | 'unavailable' | 'error'

const commandKind = (error: unknown) => typeof error === 'object' && error !== null && 'kind' in error
  ? String((error as { kind: unknown }).kind)
  : ''

const copyText = async (contents: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(contents)
    return
  }
  const area = document.createElement('textarea')
  area.value = contents
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  const copied = document.execCommand('copy')
  area.remove()
  if (!copied) throw new Error('copy unavailable')
}

const latestPairingMarker = (status?: DesktopSyncStatus) => {
  const latest = status?.pairedDevices.at(-1)
  return latest ? `${latest.deviceId}:${latest.pairedAt}` : ''
}

export function PhoneSyncSettings() {
  const { showToast } = useToast()
  const [serviceState, setServiceState] = useState<ServiceState>('loading')
  const [status, setStatus] = useState<DesktopSyncStatus>()
  const [pairing, setPairing] = useState<PairingBootstrap>()
  const [qrDataUrl, setQrDataUrl] = useState<string>()
  const [secondsRemaining, setSecondsRemaining] = useState(0)
  const [opening, setOpening] = useState(false)
  const [pairingExpired, setPairingExpired] = useState(false)
  const pairingRef = useRef<PairingBootstrap>()
  const pairingBaseline = useRef('')

  const refreshStatus = async () => {
    try {
      const next = await getDesktopSyncStatus()
      setStatus(next)
      setServiceState('ready')
      if (pairingRef.current && latestPairingMarker(next) !== pairingBaseline.current) {
        pairingRef.current = undefined
        setPairing(undefined)
        setQrDataUrl(undefined)
        setPairingExpired(false)
        showToast('Telefon połączony')
      }
    } catch (error) {
      const kind = commandKind(error)
      setServiceState(kind === 'sync_service_unavailable' ? 'unavailable' : 'error')
    }
  }

  useEffect(() => {
    void refreshStatus()
    const interval = window.setInterval(() => { void refreshStatus() }, 2_500)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!pairing) return
    const tick = () => {
      const remaining = pairingSecondsRemaining(pairing)
      setSecondsRemaining(remaining)
      if (remaining === 0) {
        pairingRef.current = undefined
        setPairing(undefined)
        setQrDataUrl(undefined)
        setPairingExpired(true)
        void cancelDesktopPairing().catch(() => undefined)
      }
    }
    tick()
    const interval = window.setInterval(tick, 1_000)
    return () => window.clearInterval(interval)
  }, [pairing])

  useEffect(() => () => {
    if (pairingRef.current) void cancelDesktopPairing().catch(() => undefined)
  }, [])

  const openPairing = async () => {
    setOpening(true)
    setPairingExpired(false)
    try {
      pairingBaseline.current = latestPairingMarker(status)
      const next = await openDesktopPairing()
      const qr = await pairingQrDataUrl(next)
      pairingRef.current = next
      setPairing(next)
      setQrDataUrl(qr)
      setSecondsRemaining(pairingSecondsRemaining(next))
      setServiceState('ready')
    } catch (error) {
      const kind = commandKind(error)
      setServiceState(kind === 'sync_service_unavailable' ? 'unavailable' : 'error')
      showToast('Nie udało się przygotować kodu parowania.', 'info')
    } finally {
      setOpening(false)
    }
  }

  const closePairing = async () => {
    pairingRef.current = undefined
    setPairing(undefined)
    setQrDataUrl(undefined)
    await cancelDesktopPairing().catch(() => undefined)
  }

  const pairedPhone = status?.pairedDevices.at(-1)
  const statusText = serviceState === 'loading'
    ? 'Sprawdzanie…'
    : serviceState === 'unavailable'
      ? 'Usługa synchronizacji niedostępna'
      : serviceState === 'error'
        ? 'Brak sieci lokalnej'
        : pairedPhone
          ? 'Telefon połączony'
          : 'Usługa gotowa'

  return (
    <section className="card settings-section phone-sync-settings">
      <div className="settings-section__heading"><span className="settings-icon"><Smartphone size={19} /></span><div><h2>Telefon i synchronizacja</h2><p>Bezpieczna synchronizacja z Androidem w tej samej sieci lokalnej.</p></div></div>
      <div className="phone-sync-summary">
        <div><span>Synchronizacja lokalna</span><strong>{statusText}</strong>{pairedPhone && <small>{pairedPhone.displayName}{pairedPhone.lastSeenAt ? ` · ostatnia synchronizacja ${pairedPhone.lastSeenAt}` : ''}</small>}</div>
        <button className="button button--primary" type="button" disabled={opening || Boolean(pairing)} onClick={() => void openPairing()}><Link2 size={16} /> {opening ? 'Przygotowuję…' : 'Połącz telefon'}</button>
      </div>

      {pairingExpired && <p className="phone-sync-expired">Kod wygasł. Wygeneruj nowy kod parowania.</p>}
      {pairing && qrDataUrl && <div className="phone-pairing-panel">
        <button className="icon-button phone-pairing-close" type="button" onClick={() => void closePairing()} aria-label="Zamknij kod parowania"><X size={16} /></button>
        <img src={qrDataUrl} alt="Kod QR do sparowania telefonu z GreekGod" width="188" height="188" />
        <div><strong>Zeskanuj kod telefonem</strong><p>Kod jest jednorazowy i wygaśnie za {secondsRemaining} s.</p><button className="button button--secondary button--small" type="button" onClick={() => void copyText(pairingPayloadJson(pairing)).then(() => showToast('Kod parowania skopiowany')).catch(() => showToast('Nie udało się skopiować kodu.', 'info'))}><Copy size={15} /> Kopiuj kod</button></div>
      </div>}
    </section>
  )
}
