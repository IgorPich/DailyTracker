import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import type { AppDataStore } from '@greekgod/core'
import type { AppData } from '../../../src/types'
import { createInitialData, normalizeData } from '../../../src/utils/storage'
import { applySqliteMigrations } from './sqliteMigrations.ts'
import { mapSqliteError, SqliteStoreError } from './sqliteStoreError.ts'

export const SQLITE_DEVELOPMENT_FILENAME = 'greekgod-v3.sqlite'

export interface SqliteAppDataStoreOptions {
  allowedRoot: string
}

interface AppDataRow {
  data_version: number
  payload_json: string
}

const pathIsInside = (candidate: string, root: string) => {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
}

const assertIsolatedDatabasePath = (databasePath: string, allowedRoot: string) => {
  const resolvedPath = resolve(databasePath)
  const resolvedRoot = resolve(allowedRoot)
  if (basename(resolvedPath) !== SQLITE_DEVELOPMENT_FILENAME || !pathIsInside(resolvedPath, resolvedRoot)) {
    throw new SqliteStoreError(
      'database-unavailable',
      `SQLite development Store must be ${SQLITE_DEVELOPMENT_FILENAME} inside its explicit isolated root.`,
    )
  }
  const appDataDirectory = process.env.APPDATA
  if (appDataDirectory) {
    const productionRoot = resolve(appDataDirectory, 'com.igorpich.formlog')
    if (pathIsInside(resolvedPath, productionRoot)) {
      throw new SqliteStoreError('database-unavailable', 'SQLite development Store cannot use the production GreekGod directory.')
    }
  }
  return resolvedPath
}

const fingerprint = (value: AppData) => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex')
  .slice(0, 16)

export class SqliteAppDataStore implements AppDataStore {
  readonly databasePath: string
  private readonly database: DatabaseSync
  private operationQueue = Promise.resolve()
  private closed = false

  constructor(databasePath: string, options: SqliteAppDataStoreOptions) {
    this.databasePath = assertIsolatedDatabasePath(databasePath, options.allowedRoot)
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(this.databasePath, { timeout: 5000 })
      database.exec('PRAGMA foreign_keys = ON')
      applySqliteMigrations(database)
      this.database = database
    } catch (error) {
      if (database?.isOpen) database.close()
      throw mapSqliteError(error, 'database-unavailable', 'Could not initialize the SQLite development Store.')
    }
  }

  private rollbackIfActive() {
    try {
      if (this.database.isTransaction) this.database.exec('ROLLBACK')
    } catch {
      // The original write error remains the useful failure when the connection itself is unavailable.
    }
  }

  async load(): Promise<AppData> {
    try {
      const row = this.database.prepare(`
        SELECT data_version, payload_json
        FROM app_data
        WHERE singleton_id = 1
      `).get() as unknown as AppDataRow | undefined
      if (!row) return createInitialData()
      if (typeof row.payload_json !== 'string' || typeof row.data_version !== 'number') {
        throw new SqliteStoreError('invalid-or-corrupt-data', 'SQLite AppData row has invalid columns.')
      }
      const parsed = JSON.parse(row.payload_json) as unknown
      const normalized = normalizeData(parsed)
      if (normalized.version !== row.data_version) {
        throw new SqliteStoreError('invalid-or-corrupt-data', 'SQLite data_version does not match the AppData payload.')
      }
      return normalized
    } catch (error) {
      throw mapSqliteError(error, 'invalid-or-corrupt-data', 'Could not read valid AppData from SQLite.')
    }
  }

  save(data: AppData): Promise<void> {
    this.operationQueue = this.operationQueue.catch(() => undefined).then(() => {
      const payload = JSON.stringify(data)
      try {
        this.database.exec('BEGIN IMMEDIATE')
        this.database.prepare(`
          INSERT INTO app_data (singleton_id, data_version, payload_json)
          VALUES (1, ?, ?)
          ON CONFLICT(singleton_id) DO UPDATE SET
            data_version = excluded.data_version,
            payload_json = excluded.payload_json
        `).run(data.version, payload)
        this.database.exec('COMMIT')
      } catch (error) {
        this.rollbackIfActive()
        throw mapSqliteError(error, 'write-failed', 'Could not write AppData to SQLite.')
      }
    })
    return this.operationQueue
  }

  backupBeforeImport(data: AppData): Promise<void> {
    this.operationQueue = this.operationQueue.catch(() => undefined).then(async () => {
      const active = this.database.prepare(`
        SELECT payload_json
        FROM app_data
        WHERE singleton_id = 1
      `).get() as unknown as { payload_json?: unknown } | undefined
      const expectedPayload = JSON.stringify(data)
      if (active?.payload_json !== expectedPayload) {
        throw new SqliteStoreError('write-failed', 'SQLite backup source does not match the active AppData aggregate.')
      }
      const backupPath = `${this.databasePath}.pre-import-${fingerprint(data)}.backup.sqlite`
      try {
        if (!existsSync(backupPath)) await backup(this.database, backupPath)
        const verificationDatabase = new DatabaseSync(backupPath, { readOnly: true })
        try {
          const verified = verificationDatabase.prepare(`
            SELECT payload_json
            FROM app_data
            WHERE singleton_id = 1
          `).get() as unknown as { payload_json?: unknown } | undefined
          if (verified?.payload_json !== expectedPayload) {
            throw new SqliteStoreError('write-failed', 'SQLite backup verification failed.')
          }
        } finally {
          verificationDatabase.close()
        }
      } catch (error) {
        throw mapSqliteError(error, 'write-failed', 'Could not create a verified SQLite backup.')
      }
    })
    return this.operationQueue
  }

  async close(): Promise<void> {
    await this.operationQueue.catch(() => undefined)
    if (!this.closed) {
      this.database.close()
      this.closed = true
    }
  }
}
