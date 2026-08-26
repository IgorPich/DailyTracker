import type { DailyEntry } from './types'

export const upsertDailyEntry = (
  entries: readonly DailyEntry[],
  entry: DailyEntry,
): DailyEntry[] => [
  ...entries.filter((item) => item.id !== entry.id && item.date !== entry.date),
  entry,
]

export const deleteDailyEntry = (
  entries: readonly DailyEntry[],
  id: string,
): DailyEntry[] => entries.filter((entry) => entry.id !== id)

export const findDailyEntryByDate = (
  entries: readonly DailyEntry[],
  date: string,
): DailyEntry | undefined => entries.find((entry) => entry.date === date)
