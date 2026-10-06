import jsQR from 'jsqr'
import type { PairingCode } from './mobileStore'

export const validatePairingCode = (
  raw: string,
  nowEpoch = Math.floor(Date.now() / 1_000),
): PairingCode => {
  const parsed = JSON.parse(raw) as Partial<PairingCode>
  if (!parsed.baseUrl?.startsWith('https://') || !parsed.serviceId || !parsed.nonce
    || !/^[a-f\d]{64}$/i.test(parsed.certificateFingerprintSha256 ?? '')
    || !Number.isSafeInteger(parsed.expiresAtEpoch)) {
    throw new Error('Nieprawidłowy kod parowania.')
  }
  if ((parsed.expiresAtEpoch as number) <= nowEpoch) {
    throw new Error('Kod parowania wygasł. Wygeneruj nowy na PC.')
  }
  return parsed as PairingCode
}

export const pairingPanelVisible = (hasRemote: boolean, replacing: boolean) =>
  !hasRemote || replacing

export const decodePairingQrImage = async (image: File): Promise<string> => {
  const bitmap = await createImageBitmap(image)
  try {
    const maximumDimension = 1_600
    const scale = Math.min(1, maximumDimension / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Skaner QR jest niedostępny.')
    context.drawImage(bitmap, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height)
    const decoded = jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' })
    if (!decoded?.data) throw new Error('Nie znaleziono kodu QR. Spróbuj ponownie.')
    return decoded.data
  } finally {
    bitmap.close()
  }
}
