import { isDeepStrictEqual } from 'node:util'
import type { AppDataStore } from '@greekgod/core'
import type { AppData } from '../../src/types'

export interface LegacyToSqliteMigrationResult {
  legacyData: AppData
  sqliteData: AppData
}

export const migrateLegacyAppDataToSqlite = async (
  legacyStore: AppDataStore,
  sqliteStore: AppDataStore,
): Promise<LegacyToSqliteMigrationResult> => {
  const legacyData = await legacyStore.load()
  await sqliteStore.save(legacyData)
  const sqliteData = await sqliteStore.load()
  if (!isDeepStrictEqual(sqliteData, legacyData)) {
    throw new Error('Legacy to SQLite migration did not preserve the complete AppData aggregate.')
  }
  return { legacyData, sqliteData }
}
