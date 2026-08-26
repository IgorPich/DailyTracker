import { deepStrictEqual, equal, rejects, strictEqual } from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import test from 'node:test'
import type { AppDataStore } from '@greekgod/core'
import { createInitialData } from '../../src/utils/storage.ts'
import { fullAppDataFixture } from '../fixtures/full-app-data.fixture.ts'
import { registerAppDataStoreContract } from './appDataStore.contract.ts'
import { SqliteAppDataStore, SQLITE_DEVELOPMENT_FILENAME } from './sqlite/sqliteAppDataStore.ts'
import { applySqliteMigrations, SQLITE_MIGRATIONS } from './sqlite/sqliteMigrations.ts'
import { SqliteStoreError } from './sqlite/sqliteStoreError.ts'

interface SqliteHarness {
  directory: string
  databasePath: string
  stores: SqliteAppDataStore[]
  createStore(): SqliteAppDataStore
  cleanup(): Promise<void>
}

const createSqliteHarness = async (): Promise<SqliteHarness> => {
  const directory = await mkdtemp(join(tmpdir(), 'greekgod-sqlite-test-'))
  const databasePath = join(directory, SQLITE_DEVELOPMENT_FILENAME)
  const stores: SqliteAppDataStore[] = []
  return {
    directory,
    databasePath,
    stores,
    createStore() {
      const store = new SqliteAppDataStore(databasePath, { allowedRoot: directory })
      stores.push(store)
      return store
    },
    async cleanup() {
      await Promise.all(stores.map((store) => store.close()))
      await rm(directory, { recursive: true, force: true })
    },
  }
}

registerAppDataStoreContract('SQLite development adapter', async () => {
  const harness = await createSqliteHarness()
  return {
    store: harness.createStore(),
    reopen: async (): Promise<AppDataStore> => harness.createStore(),
    cleanup: () => harness.cleanup(),
    expectedInitialData: createInitialData(),
  }
})

test('SQLite migrations are versioned, checksummed and idempotent from an empty database', async () => {
  const harness = await createSqliteHarness()
  try {
    const first = harness.createStore()
    await first.close()
    const database = new DatabaseSync(harness.databasePath)
    try {
      applySqliteMigrations(database)
      const migrations = database.prepare(`
        SELECT version, name, checksum
        FROM schema_migrations
        ORDER BY version ASC
      `).all() as unknown as Array<{ version: number; name: string; checksum: string }>
      deepStrictEqual(
        migrations.map(({ version, name, checksum }) => ({ version, name, checksum })),
        SQLITE_MIGRATIONS.map(({ version, name, checksum }) => ({ version, name, checksum })),
      )
      equal((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1)
      equal((database.prepare(`SELECT COUNT(*) AS count FROM app_data`).get() as { count: number }).count, 0)
    } finally {
      database.close()
    }
  } finally {
    await harness.cleanup()
  }
})

test('SQLite migration failure rolls back and reports its version', () => {
  const database = new DatabaseSync(':memory:')
  try {
    const broken = {
      version: 1,
      name: 'broken-migration',
      checksum: 'synthetic-checksum',
      sql: 'CREATE TABLE transient_value (id INTEGER); THIS IS NOT SQL;',
    }
    let received: unknown
    try {
      applySqliteMigrations(database, [broken])
    } catch (error) {
      received = error
    }
    strictEqual(received instanceof SqliteStoreError, true)
    strictEqual((received as SqliteStoreError).kind, 'migration-failed')
    strictEqual((received as SqliteStoreError).migrationVersion, 1)
    strictEqual(database.prepare(`SELECT name FROM sqlite_master WHERE name = 'transient_value'`).get(), undefined)
  } finally {
    database.close()
  }
})

test('SQLite rejects a changed checksum for an already applied migration', async () => {
  const harness = await createSqliteHarness()
  try {
    const store = harness.createStore()
    await store.close()
    const database = new DatabaseSync(harness.databasePath)
    database.prepare(`UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1`).run()
    database.close()

    let received: unknown
    try {
      harness.createStore()
    } catch (error) {
      received = error
    }
    strictEqual(received instanceof SqliteStoreError, true)
    strictEqual((received as SqliteStoreError).kind, 'migration-failed')
  } finally {
    await harness.cleanup()
  }
})

test('SQLite reports semantically invalid payload as corrupt data', async () => {
  const harness = await createSqliteHarness()
  try {
    const store = harness.createStore()
    await store.save(fullAppDataFixture())
    await store.close()
    const database = new DatabaseSync(harness.databasePath)
    database.prepare(`UPDATE app_data SET payload_json = '{}' WHERE singleton_id = 1`).run()
    database.close()
    const reopened = harness.createStore()

    await rejects(reopened.load(), (error: unknown) => (
      error instanceof SqliteStoreError && error.kind === 'invalid-or-corrupt-data'
    ))
  } finally {
    await harness.cleanup()
  }
})

test('SQLite rejects a raw payload version that differs from data_version', async () => {
  const harness = await createSqliteHarness()
  try {
    const store = harness.createStore()
    await store.save(fullAppDataFixture())
    await store.close()
    const olderPayload = fullAppDataFixture()
    olderPayload.version = 3
    const database = new DatabaseSync(harness.databasePath)
    database.prepare(`
      UPDATE app_data
      SET data_version = 4, payload_json = ?
      WHERE singleton_id = 1
    `).run(JSON.stringify(olderPayload))
    database.close()
    const reopened = harness.createStore()

    await rejects(reopened.load(), (error: unknown) => (
      error instanceof SqliteStoreError && error.kind === 'invalid-or-corrupt-data'
    ))
  } finally {
    await harness.cleanup()
  }
})

test('SQLite accepts an aligned older payload version and normalizes it after validation', async () => {
  const harness = await createSqliteHarness()
  try {
    const store = harness.createStore()
    await store.save(fullAppDataFixture())
    await store.close()
    const olderPayload = fullAppDataFixture()
    olderPayload.version = 3
    const database = new DatabaseSync(harness.databasePath)
    database.prepare(`
      UPDATE app_data
      SET data_version = 3, payload_json = ?
      WHERE singleton_id = 1
    `).run(JSON.stringify(olderPayload))
    database.close()
    const reopened = harness.createStore()

    equal((await reopened.load()).version, 4)
  } finally {
    await harness.cleanup()
  }
})

test('SQLite keeps exactly one AppData row after repeated full aggregate writes', async () => {
  const harness = await createSqliteHarness()
  try {
    const store = harness.createStore()
    await store.save(fullAppDataFixture())
    const replacement = fullAppDataFixture()
    replacement.coachNotes.replaced = 'yes'
    await store.save(replacement)
    await store.close()
    const database = new DatabaseSync(harness.databasePath, { readOnly: true })
    try {
      equal((database.prepare(`SELECT COUNT(*) AS count FROM app_data`).get() as { count: number }).count, 1)
    } finally {
      database.close()
    }
  } finally {
    await harness.cleanup()
  }
})

test('SQLite reports constraint violations separately from generic write failures', async () => {
  const harness = await createSqliteHarness()
  try {
    const initialized = harness.createStore()
    await initialized.close()
    const database = new DatabaseSync(harness.databasePath)
    database.exec(`
      CREATE TRIGGER reject_synthetic_app_data
      BEFORE INSERT ON app_data
      BEGIN
        SELECT RAISE(ABORT, 'synthetic constraint');
      END;
    `)
    database.close()
    const store = harness.createStore()

    await rejects(store.save(fullAppDataFixture()), (error: unknown) => (
      error instanceof SqliteStoreError && error.kind === 'constraint-violation'
    ))
  } finally {
    await harness.cleanup()
  }
})

test('SQLite reports every operation on a closed database as unavailable', async () => {
  const harness = await createSqliteHarness()
  try {
    const store = harness.createStore()
    await store.close()
    const unavailable = (error: unknown) => (
      error instanceof SqliteStoreError && error.kind === 'database-unavailable'
    )

    await rejects(store.load(), unavailable)
    await rejects(store.save(fullAppDataFixture()), unavailable)
    await rejects(store.backupBeforeImport(fullAppDataFixture()), unavailable)
  } finally {
    await harness.cleanup()
  }
})

test('SQLite maps save and backup serialization failures to typed write errors', async () => {
  const harness = await createSqliteHarness()
  try {
    const store = harness.createStore()
    const circular = fullAppDataFixture()
    ;(circular as unknown as { self: unknown }).self = circular
    const writeFailure = (error: unknown) => (
      error instanceof SqliteStoreError && error.kind === 'write-failed'
    )

    await rejects(store.save(circular), writeFailure)
    await rejects(store.backupBeforeImport(circular), writeFailure)
  } finally {
    await harness.cleanup()
  }
})

test('SQLite backs up a supplied snapshot before the active Store has been saved', async () => {
  const harness = await createSqliteHarness()
  try {
    const store = harness.createStore()
    const fixture = fullAppDataFixture()

    await store.backupBeforeImport(fixture)

    deepStrictEqual(await store.load(), createInitialData())
    const backupFiles = (await readdir(harness.directory)).filter((name) => name.endsWith('.backup.sqlite'))
    equal(backupFiles.length, 1)
    const backupDatabase = new DatabaseSync(join(harness.directory, backupFiles[0]), { readOnly: true })
    try {
      const stored = backupDatabase.prepare(`
        SELECT data_version, payload_json
        FROM app_data
        WHERE singleton_id = 1
      `).get() as { data_version: number; payload_json: string }
      equal(stored.data_version, fixture.version)
      equal(stored.payload_json, JSON.stringify(fixture))
    } finally {
      backupDatabase.close()
    }
  } finally {
    await harness.cleanup()
  }
})

test('SQLite refuses paths outside the explicit test root and the production Store directory', async () => {
  const harness = await createSqliteHarness()
  try {
    const outside = join(harness.directory, '..', SQLITE_DEVELOPMENT_FILENAME)
    strictEqual(
      (() => {
        try {
          new SqliteAppDataStore(outside, { allowedRoot: harness.directory })
          return false
        } catch (error) {
          return error instanceof SqliteStoreError && error.kind === 'database-unavailable'
        }
      })(),
      true,
    )
    const missingDirectoryPath = join(harness.directory, 'missing-directory', SQLITE_DEVELOPMENT_FILENAME)
    strictEqual(
      (() => {
        try {
          new SqliteAppDataStore(missingDirectoryPath, { allowedRoot: harness.directory })
          return false
        } catch (error) {
          return error instanceof SqliteStoreError && error.kind === 'database-unavailable'
        }
      })(),
      true,
    )
    if (process.env.APPDATA) {
      const productionPath = join(process.env.APPDATA, 'com.igorpich.formlog', SQLITE_DEVELOPMENT_FILENAME)
      strictEqual(
        (() => {
          try {
            new SqliteAppDataStore(productionPath, { allowedRoot: join(process.env.APPDATA!, 'com.igorpich.formlog') })
            return false
          } catch (error) {
            return error instanceof SqliteStoreError && error.kind === 'database-unavailable'
          }
        })(),
        true,
      )
    }
  } finally {
    await harness.cleanup()
  }
})
