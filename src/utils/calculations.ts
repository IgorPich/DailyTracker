import type { DailyEntry, Workout } from '../types'
import { addDays, dateInRange, parseDate, toIsoDate } from './date'

export const average = (values: Array<number | undefined>) => {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!valid.length) return undefined
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

export const entriesBetween = (entries: DailyEntry[], from: string, to: string) =>
  entries.filter((entry) => dateInRange(entry.date, from, to)).sort((a, b) => a.date.localeCompare(b.date))

export const workoutsBetween = (workouts: Workout[], from: string, to: string) =>
  workouts.filter((workout) => dateInRange(workout.date, from, to)).sort((a, b) => a.date.localeCompare(b.date))

export const windowFor = (end: string, days: number, offsetDays = 0) => {
  const endDate = addDays(parseDate(end), -offsetDays)
  const startDate = addDays(endDate, -(days - 1))
  return { from: toIsoDate(startDate), to: toIsoDate(endDate) }
}

export const latestMeasurement = (entries: DailyEntry[], key: 'waist' | 'weight') =>
  [...entries]
    .filter((entry) => typeof entry[key] === 'number')
    .sort((a, b) => b.date.localeCompare(a.date))[0]

export const waistChange = (entries: DailyEntry[]) => {
  const measured = [...entries]
    .filter((entry) => typeof entry.waist === 'number')
    .sort((a, b) => b.date.localeCompare(a.date))
  if (measured.length < 2) return undefined
  return measured[0].waist! - measured[1].waist!
}

export interface WeightChartPoint {
  date: string
  label: string
  weight?: number
  movingAverage?: number
}

export const weightChartData = (entries: DailyEntry[], from?: string, to?: string): WeightChartPoint[] => {
  const all = [...entries].filter((entry) => typeof entry.weight === 'number').sort((a, b) => a.date.localeCompare(b.date))
  return all
    .filter((entry) => (!from || entry.date >= from) && (!to || entry.date <= to))
    .map((entry) => {
      const endDate = parseDate(entry.date)
      const start = toIsoDate(addDays(endDate, -6))
      const windowEntries = all.filter((item) => item.date >= start && item.date <= entry.date)
      return {
        date: entry.date,
        label: entry.date.slice(5).replace('-', '.'),
        weight: entry.weight,
        movingAverage: average(windowEntries.map((item) => item.weight)),
      }
    })
}

export const formatNumber = (value: number | undefined, decimals = 1) =>
  value === undefined ? '—' : value.toLocaleString('pl-PL', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })

export const formatInteger = (value: number | undefined) =>
  value === undefined ? '—' : Math.round(value).toLocaleString('pl-PL')

export const signed = (value: number | undefined, suffix = '') => {
  if (value === undefined) return '—'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${formatNumber(value)}${suffix}`
}
