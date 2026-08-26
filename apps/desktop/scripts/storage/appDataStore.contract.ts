import { deepStrictEqual, notStrictEqual } from 'node:assert/strict'
import test from 'node:test'
import type { AppDataStore } from '@greekgod/core'
import type { AppData } from '../../src/types'
import { normalizeData } from '../../src/utils/storage'
import { fullAppDataFixture } from '../fixtures/full-app-data.fixture.ts'

export interface AppDataStoreHarness {
  store: AppDataStore
  reopen(): Promise<AppDataStore>
  cleanup(): Promise<void>
  expectedInitialData: AppData
}

export type AppDataStoreHarnessFactory = () => Promise<AppDataStoreHarness>

const serializedClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const normalizedStoredValue = (value: AppData): AppData => normalizeData(serializedClone(value))

const withHarness = async (
  createHarness: AppDataStoreHarnessFactory,
  assertion: (harness: AppDataStoreHarness) => Promise<void>,
) => {
  const harness = await createHarness()
  try {
    await assertion(harness)
  } finally {
    await harness.cleanup()
  }
}

export const registerAppDataStoreContract = (
  implementationName: string,
  createHarness: AppDataStoreHarnessFactory,
) => {
  test(`${implementationName}: empty store loads the current initial aggregate`, async () => {
    await withHarness(createHarness, async ({ store, expectedInitialData }) => {
      deepStrictEqual(await store.load(), expectedInitialData)
    })
  })

  test(`${implementationName}: full AppData survives save, reopen and load without reordering`, async () => {
    await withHarness(createHarness, async (harness) => {
      const fixture = fullAppDataFixture()
      const sourceBefore = structuredClone(fixture)

      await harness.store.save(fixture)
      const reopened = await harness.reopen()
      const loaded = await reopened.load()

      deepStrictEqual(loaded, normalizedStoredValue(fixture))
      deepStrictEqual(fixture, sourceBefore)
      deepStrictEqual(loaded.workouts.map((item) => item.id), ['workout-z', 'workout-a'])
      deepStrictEqual(loaded.workouts[0].exercises.map((item) => item.id), ['workout-row-z', 'workout-custom-a'])
      deepStrictEqual(loaded.workouts[0].exercises[0].sets.map((item) => item.id), ['row-set-z', 'row-set-a'])
      deepStrictEqual(loaded.templates.map((item) => item.id), ['template-d', 'template-a'])
      deepStrictEqual(loaded.templates[0].exercises.map((item) => item.id), ['template-row-z', 'template-custom-a'])
      notStrictEqual(loaded, fixture)
    })
  })

  test(`${implementationName}: save replaces the aggregate instead of merging it`, async () => {
    await withHarness(createHarness, async (harness) => {
      await harness.store.save(fullAppDataFixture())
      const replacement = fullAppDataFixture()
      replacement.dailyEntries = [replacement.dailyEntries[1]]
      replacement.workouts = []
      replacement.settings.gymLocations = []
      replacement.coachNotes = {}

      await harness.store.save(replacement)
      deepStrictEqual(await (await harness.reopen()).load(), normalizedStoredValue(replacement))
    })
  })

  test(`${implementationName}: concurrent save calls resolve in call order and keep the last aggregate`, async () => {
    await withHarness(createHarness, async (harness) => {
      const first = fullAppDataFixture()
      first.coachNotes.order = 'first'
      const second = fullAppDataFixture()
      second.coachNotes.order = 'second'

      await Promise.all([harness.store.save(first), harness.store.save(second)])
      deepStrictEqual(await (await harness.reopen()).load(), normalizedStoredValue(second))
    })
  })

  test(`${implementationName}: backup is idempotent and never changes active data`, async () => {
    await withHarness(createHarness, async (harness) => {
      const fixture = fullAppDataFixture()
      await harness.store.save(fixture)

      await harness.store.backupBeforeImport(fixture)
      await harness.store.backupBeforeImport(fixture)

      deepStrictEqual(await (await harness.reopen()).load(), normalizedStoredValue(fixture))
    })
  })

  test(`${implementationName}: backup accepts the loaded snapshot before the first save`, async () => {
    await withHarness(createHarness, async (harness) => {
      const initialSnapshot = await harness.store.load()

      await harness.store.backupBeforeImport(initialSnapshot)

      deepStrictEqual(await (await harness.reopen()).load(), harness.expectedInitialData)
    })
  })
}
