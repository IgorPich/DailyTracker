import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { SqliteStoreError } from './sqliteStoreError.ts'

export interface SqliteMigration {
  version: number
  name: string
  sql: string
  checksum: string
}

const migration = (version: number, name: string, sql: string): SqliteMigration => ({
  version,
  name,
  sql,
  checksum: createHash('sha256').update(sql).digest('hex'),
})

export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  migration(1, 'mirror-current-app-data', `
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE TABLE app_data (
      singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      data_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
    ) STRICT;

    PRAGMA user_version = 1;
  `),
]

interface AppliedMigrationRow {
  version: number
  name: string
  checksum: string
}

const migrationTableExists = (database: DatabaseSync) => Boolean(database.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table' AND name = 'schema_migrations'
`).get())

export const applySqliteMigrations = (
  database: DatabaseSync,
  migrations: readonly SqliteMigration[] = SQLITE_MIGRATIONS,
) => {
  const versions = migrations.map((item) => item.version)
  if (new Set(versions).size !== versions.length || versions.some((version, index) => index > 0 && version <= versions[index - 1])) {
    throw new SqliteStoreError('migration-failed', 'SQLite migrations must have unique ascending versions.')
  }

  let applied: AppliedMigrationRow[] = []
  try {
    if (migrationTableExists(database)) {
      applied = database.prepare(`
        SELECT version, name, checksum
        FROM schema_migrations
        ORDER BY version ASC
      `).all() as unknown as AppliedMigrationRow[]
    }
  } catch (error) {
    throw new SqliteStoreError('migration-failed', 'Could not read SQLite migration history.', { cause: error })
  }

  for (const row of applied) {
    const current = migrations.find((item) => item.version === row.version)
    if (!current || current.name !== row.name || current.checksum !== row.checksum) {
      throw new SqliteStoreError('migration-failed', `SQLite migration ${row.version} does not match its recorded checksum.`, {
        migrationVersion: row.version,
      })
    }
  }

  const appliedVersions = new Set(applied.map((item) => item.version))
  for (const item of migrations) {
    if (appliedVersions.has(item.version)) continue
    try {
      database.exec('BEGIN IMMEDIATE')
      database.exec(item.sql)
      database.prepare(`
        INSERT INTO schema_migrations (version, name, checksum)
        VALUES (?, ?, ?)
      `).run(item.version, item.name, item.checksum)
      database.exec('COMMIT')
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK')
      throw new SqliteStoreError('migration-failed', `SQLite migration ${item.version} failed.`, {
        cause: error,
        migrationVersion: item.version,
      })
    }
  }
}
