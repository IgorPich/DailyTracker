import type { DailyEntry } from './types'

export const upsertDailyEntry = (
  entries: readonly DailyEntry[],
  entry: DailyEntry,
): DailyEntry[] => [
  ...entries.filter((item) => item.id !== entry.id && item.date !== entry.date),
  entry,
]
