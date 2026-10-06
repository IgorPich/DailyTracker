import { invoke, isTauri } from '@tauri-apps/api/core'
import QRCode from 'qrcode'

export interface PairedPhone {
  deviceId: string
  displayName: string
  pairedAt: string
  lastSeenAt?: string
  revokedAt?: string
}

export interface DesktopSyncStatus {
  serviceId: string
  certificateFingerprintSha256: string
  pairedDevices: PairedPhone[]
}

export interface PairingBootstrap {
  baseUrl: string
  serviceId: string
  nonce: string
  certificateFingerprintSha256: string
  expiresAtEpoch: number
}

const requireDesktop = () => {
  if (!isTauri()) throw new Error('Synchronizacja z telefonem jest dostępna w aplikacji Windows.')
}

export const getDesktopSyncStatus = async () => {
  requireDesktop()
  return invoke<DesktopSyncStatus>('desktop_sync_status')
}

export const openDesktopPairing = async () => {
  requireDesktop()
  return invoke<PairingBootstrap>('desktop_sync_open_pairing')
}

export const cancelDesktopPairing = async () => {
  if (!isTauri()) return
  await invoke<void>('desktop_sync_cancel_pairing')
}

export const pairingPayloadJson = (pairing: PairingBootstrap) => JSON.stringify({
  baseUrl: pairing.baseUrl,
  serviceId: pairing.serviceId,
  nonce: pairing.nonce,
  certificateFingerprintSha256: pairing.certificateFingerprintSha256,
  expiresAtEpoch: pairing.expiresAtEpoch,
})

export const pairingQrDataUrl = (pairing: PairingBootstrap) => QRCode.toDataURL(
  pairingPayloadJson(pairing),
  { errorCorrectionLevel: 'M', margin: 1, width: 188 },
)

export const pairingSecondsRemaining = (pairing: PairingBootstrap, nowMs = Date.now()) => Math.max(
  0,
  pairing.expiresAtEpoch - Math.floor(nowMs / 1_000),
)
