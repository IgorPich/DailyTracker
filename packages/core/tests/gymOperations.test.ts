import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert/strict'
import test from 'node:test'
import { addGymLocation, deleteGymLocation, renameGymLocation } from '../src/gymOperations.ts'
import type { AppData } from '../src/types.ts'
import { workoutFixture as workout } from './fixtures/workout.fixture.ts'

const dataFixture = (): AppData => ({
  version: 4,
  dailyEntries: [],
  workouts: [
    workout('workout-a', { gymLocation: 'Klub Północ' }),
    workout('workout-b', { gymLocation: 'klub północ' }),
    workout('workout-c', { gymLocation: 'Klub Zachód' }),
  ],
  templates: [],
  exerciseLibrary: [],
  settings: {
    phase: 'Maintenance',
    calorieTarget: 2800,
    proteinTarget: 160,
    gymLocations: ['Klub Północ', 'Klub Zachód'],
    lastGymLocation: 'Klub Północ',
    trendThresholds: { lossBelow: -0.15, stableUpper: 0.05, slowGainUpper: 0.2 },
  },
  coachNotes: {},
})

test('adds a trimmed gym at the end without changing other AppData', () => {
  const data = dataFixture()
  const result = addGymLocation(data, '  Klub Południe  ')

  deepStrictEqual(result.settings.gymLocations, ['Klub Północ', 'Klub Zachód', 'Klub Południe'])
  strictEqual(result.workouts, data.workouts)
  strictEqual(result.templates, data.templates)
})

test('gym add keeps the same AppData for blank and Polish case-insensitive duplicates', () => {
  const data = dataFixture()

  strictEqual(addGymLocation(data, '   '), data)
  strictEqual(addGymLocation(data, 'klub północ'), data)
})

test('gym add preserves the current accent and spacing comparison behavior', () => {
  const data = dataFixture()

  deepStrictEqual(addGymLocation(data, 'Klub Polnoc').settings.gymLocations, ['Klub Północ', 'Klub Zachód', 'Klub Polnoc'])
  deepStrictEqual(addGymLocation(data, 'Klub  Północ').settings.gymLocations, ['Klub Północ', 'Klub Zachód', 'Klub  Północ'])
})

test('rename gym atomically updates saved locations, last gym and exact historical snapshots', () => {
  const data = dataFixture()
  const dataBefore = structuredClone(data)
  const result = renameGymLocation(data, 'Klub Północ', '  Klub Centrum  ')

  deepStrictEqual(result.settings.gymLocations, ['Klub Centrum', 'Klub Zachód'])
  strictEqual(result.settings.lastGymLocation, 'Klub Centrum')
  deepStrictEqual(result.workouts.map((item) => item.gymLocation), ['Klub Centrum', 'klub północ', 'Klub Zachód'])
  strictEqual(result.workouts[1], data.workouts[1])
  strictEqual(result.workouts[2], data.workouts[2])
  strictEqual(result.templates, data.templates)
  deepStrictEqual(data, dataBefore)
})

test('rename gym still updates last gym and history when the saved list lacks the old name', () => {
  const data = dataFixture()
  data.settings.gymLocations = ['Klub Zachód']

  const result = renameGymLocation(data, 'Klub Północ', 'Klub Centrum')

  deepStrictEqual(result.settings.gymLocations, ['Klub Zachód'])
  strictEqual(result.settings.lastGymLocation, 'Klub Centrum')
  strictEqual(result.workouts[0].gymLocation, 'Klub Centrum')
})

test('rename gym is a no-op for blank, unchanged and colliding names', () => {
  const data = dataFixture()

  strictEqual(renameGymLocation(data, 'Klub Północ', '   '), data)
  strictEqual(renameGymLocation(data, 'Klub Północ', 'Klub Północ'), data)
  strictEqual(renameGymLocation(data, 'Klub Północ', 'klub zachód'), data)
})

test('delete gym removes only settings references and preserves every workout snapshot', () => {
  const data = dataFixture()
  data.settings.gymLocations = ['Klub Północ', 'Klub Zachód', 'Klub Północ']
  const workoutsBefore = structuredClone(data.workouts)
  const result = deleteGymLocation(data, 'Klub Północ')

  deepStrictEqual(result.settings.gymLocations, ['Klub Zachód'])
  strictEqual(result.settings.lastGymLocation, undefined)
  deepStrictEqual(result.workouts, workoutsBefore)
  strictEqual(result.workouts, data.workouts)
  strictEqual(result.templates, data.templates)
})

test('delete missing gym still returns a new AppData and settings object', () => {
  const data = dataFixture()
  const result = deleteGymLocation(data, 'Nieistniejąca')

  notStrictEqual(result, data)
  notStrictEqual(result.settings, data.settings)
  deepStrictEqual(result.settings.gymLocations, data.settings.gymLocations)
})
