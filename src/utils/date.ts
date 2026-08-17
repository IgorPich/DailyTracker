export const isoToday = () => {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export const parseDate = (value: string) => new Date(`${value}T12:00:00`)

export const toIsoDate = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export const daysAgoIso = (days: number, from = parseDate(isoToday())) =>
  toIsoDate(addDays(from, -days))

export const formatShortDate = (value: string) =>
  new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit' }).format(parseDate(value))

export const formatLongDate = (value: string) =>
  new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' }).format(parseDate(value))

export const dateInRange = (date: string, from: string, to: string) => date >= from && date <= to
