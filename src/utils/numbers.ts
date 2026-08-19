export const normalizeDecimalInput = (value: string | number | undefined | null): number | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const normalized = value.trim().replace(',', '.')
  if (!normalized || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const formatDecimal = (value: number | undefined, maximumFractionDigits = 2, minimumFractionDigits = 0) => {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const fixed = value.toFixed(maximumFractionDigits)
  const [integer, fraction = ''] = fixed.split('.')
  const trimmedFraction = fraction.replace(/0+$/, '')
  const paddedFraction = trimmedFraction.padEnd(minimumFractionDigits, '0')
  return paddedFraction ? `${integer}.${paddedFraction}` : integer
}

export const decimalInputValue = (value: number | undefined) => value === undefined ? '' : formatDecimal(value)

