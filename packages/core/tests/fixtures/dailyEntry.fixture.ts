import type { DailyEntry } from '../../src/types.ts'

export const dailyEntryFixture = (
  id: string,
  date: string,
  fields: Partial<DailyEntry> = {},
): DailyEntry => ({ id, date, ...fields })
