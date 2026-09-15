import type { AppData } from '../../src/types.ts'
export const journalFixture = (): AppData => ({
  version: 4, templates: [], exerciseLibrary: [], workouts: [], coachNotes: {},
  settings: { phase: 'Maintenance', calorieTarget: 2400, proteinTarget: 130,
    trendThresholds: { lossBelow: -0.15, stableUpper: 0.05, slowGainUpper: 0.2 } },
  dailyEntries: [{ id: 'synthetic-day', date: '2026-01-01', weight: 80, waist: 90, measurements: { CHEST: 100, BICEPS: 35, FUTURE_METRIC: 12 } }],
})
