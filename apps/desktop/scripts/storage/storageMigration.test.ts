import { deepStrictEqual, equal } from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  addGymLocation,
  addWorkout,
  deleteDailyEntry,
  deleteGymLocation,
  deleteWorkout,
  moveItem,
  renameGymLocation,
  replaceTrainingTemplate,
  updateWorkout,
  upsertDailyEntry,
} from '@greekgod/core'
import type { AppDataStore } from '@greekgod/core'
import { LegacyAppDataStore } from '../../src/services/legacyAppDataStore.ts'
import type { LegacyAppDataStoreEnvironment, LegacyBrowserStorage } from '../../src/services/legacyAppDataStore.ts'
import type { AppData, Workout } from '../../src/types.ts'
import { STORAGE_KEY } from '../../src/utils/storage.ts'
import { fullAppDataFixture } from '../fixtures/full-app-data.fixture.ts'
import { migrateLegacyAppDataToSqlite } from './legacyToSqliteMigration.ts'
import { SqliteAppDataStore, SQLITE_DEVELOPMENT_FILENAME } from './sqlite/sqliteAppDataStore.ts'

class MemoryBrowserStorage implements LegacyBrowserStorage {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const createLegacyStore = (storage: MemoryBrowserStorage) => {
  const environment: LegacyAppDataStoreEnvironment = {
    isTauri: () => false,
    loadDesktopStore: async () => { throw new Error('Desktop Store must not be used by migration tests') },
    desktopStoreFileExists: async () => false,
    browserStorage: () => storage,
  }
  return new LegacyAppDataStore(environment)
}

interface IsolatedSqlite {
  directory: string
  databasePath: string
  store: SqliteAppDataStore
  cleanup(): Promise<void>
}

const createIsolatedSqlite = async (): Promise<IsolatedSqlite> => {
  const directory = await mkdtemp(join(tmpdir(), 'greekgod-migration-test-'))
  const databasePath = join(directory, SQLITE_DEVELOPMENT_FILENAME)
  const store = new SqliteAppDataStore(databasePath, { allowedRoot: directory })
  return {
    directory,
    databasePath,
    store,
    async cleanup() {
      await store.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

test('legacy JSON to SQLite migration preserves the complete normalized AppData aggregate', async () => {
  const browserStorage = new MemoryBrowserStorage()
  const legacyRepresentation = fullAppDataFixture()
  browserStorage.setItem(STORAGE_KEY, JSON.stringify(legacyRepresentation))
  const legacyStore = createLegacyStore(browserStorage)
  const sqlite = await createIsolatedSqlite()
  try {
    const { legacyData, sqliteData } = await migrateLegacyAppDataToSqlite(legacyStore, sqlite.store)

    deepStrictEqual(sqliteData, legacyData)
    deepStrictEqual(sqliteData.dailyEntries.map((item) => item.id), ['daily-z', 'daily-a'])
    deepStrictEqual(sqliteData.workouts.map((item) => item.id), ['workout-z', 'workout-a'])
    deepStrictEqual(sqliteData.workouts[0].exercises.map((item) => item.id), ['workout-row-z', 'workout-custom-a'])
    deepStrictEqual(sqliteData.workouts[0].exercises[0].sets.map((item) => item.id), ['row-set-z', 'row-set-a'])
    deepStrictEqual(sqliteData.templates.map((item) => item.id), ['template-d', 'template-a'])
    deepStrictEqual(sqliteData.settings.gymLocations, ['Klub Północ', 'Klub Zachód'])
    equal(sqliteData.dailyEntries[0].weight, 82.35)
    equal(sqliteData.settings.trendThresholds.lossBelow, -0.175)
  } finally {
    await sqlite.cleanup()
  }
})

test('legacy migration is deterministic on fresh databases and repeatable on the same database', async () => {
  const browserStorage = new MemoryBrowserStorage()
  browserStorage.setItem(STORAGE_KEY, JSON.stringify(fullAppDataFixture()))
  const legacyStore = createLegacyStore(browserStorage)
  const first = await createIsolatedSqlite()
  const second = await createIsolatedSqlite()
  try {
    const firstRun = await migrateLegacyAppDataToSqlite(legacyStore, first.store)
    const repeatedRun = await migrateLegacyAppDataToSqlite(legacyStore, first.store)
    const freshRun = await migrateLegacyAppDataToSqlite(legacyStore, second.store)

    deepStrictEqual(repeatedRun.sqliteData, firstRun.sqliteData)
    deepStrictEqual(freshRun.sqliteData, firstRun.sqliteData)
    const database = new DatabaseSync(first.databasePath, { readOnly: true })
    try {
      equal((database.prepare('SELECT COUNT(*) AS count FROM app_data').get() as { count: number }).count, 1)
    } finally {
      database.close()
    }
  } finally {
    await first.cleanup()
    await second.cleanup()
  }
})

const applyDifferentialOperations = (source: AppData): AppData => {
  let data = source
  data = {
    ...data,
    dailyEntries: upsertDailyEntry(data.dailyEntries, {
      id: 'daily-replacement',
      date: '2026-08-25',
      weight: 83.125,
      carbs: 333.75,
      note: 'Differential same-date update',
    }),
  }
  data = { ...data, dailyEntries: deleteDailyEntry(data.dailyEntries, 'daily-a') }

  const addedWorkout: Workout = {
    id: 'workout-differential',
    date: '2026-08-26',
    templateId: 'template-d',
    templateCode: 'D',
    templateName: 'DIFFERENTIAL SNAPSHOT',
    gymLocation: 'Klub Północ',
    duration: 55.5,
    exercises: [{
      id: 'differential-row',
      exerciseId: 'canonical-row',
      name: 'Historyczny snapshot wiosła',
      equipmentSensitive: true,
      sets: [
        { id: 'differential-set-b', weight: 85.25, reps: 6 },
        { id: 'differential-set-a', weight: 80.5, reps: 8, rir: 1.25 },
      ],
    }],
  }
  data = { ...data, workouts: addWorkout(data.workouts, addedWorkout) }
  data = {
    ...data,
    workouts: updateWorkout(data.workouts, { ...addedWorkout, duration: 61.25, note: 'Edited once' }),
  }
  data = { ...data, workouts: deleteWorkout(data.workouts, 'workout-a') }

  const template = data.templates[0]
  data = {
    ...data,
    templates: replaceTrainingTemplate(data.templates, {
      ...template,
      name: 'UPPER DIFFERENTIAL',
      exercises: moveItem(template.exercises, 1, 0),
    }),
  }
  data = addGymLocation(data, '  Klub Południe  ')
  data = renameGymLocation(data, 'Klub Północ', 'Klub Centrum')
  data = deleteGymLocation(data, 'Klub Zachód')
  return {
    ...data,
    settings: { ...data.settings, calorieTarget: 3210, proteinTarget: 191.25 },
    coachNotes: { ...data.coachNotes, differential: 'same operations' },
  }
}

const runDifferentialSequence = async (store: AppDataStore) => {
  await store.save(fullAppDataFixture())
  const current = await store.load()
  const changed = applyDifferentialOperations(current)
  await store.save(changed)
  return store.load()
}

test('Legacy and SQLite remain equivalent after the same domain operation sequence', async () => {
  const browserStorage = new MemoryBrowserStorage()
  const legacyStore = createLegacyStore(browserStorage)
  const sqlite = await createIsolatedSqlite()
  try {
    const legacyResult = await runDifferentialSequence(legacyStore)
    const sqliteResult = await runDifferentialSequence(sqlite.store)

    deepStrictEqual(sqliteResult, legacyResult)
    equal(sqliteResult.dailyEntries.filter((item) => item.date === '2026-08-25').length, 1)
    equal(sqliteResult.workouts.filter((item) => item.id === 'workout-differential').length, 1)
    deepStrictEqual(sqliteResult.settings.gymLocations, ['Klub Centrum', 'Klub Południe'])
    equal(sqliteResult.workouts[0].gymLocation, 'Klub Centrum')
    deepStrictEqual(sqliteResult.templates[0].exercises.map((item) => item.id), ['template-custom-a', 'template-row-z'])
  } finally {
    await sqlite.cleanup()
  }
})
