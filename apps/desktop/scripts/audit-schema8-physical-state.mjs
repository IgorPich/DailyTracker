import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const [databaseArgument, rootArgument, productionArgument, expectedBootstrap = 'complete'] = process.argv.slice(2)
const [databasePath, expectedRoot, productionRoot] = [databaseArgument, rootArgument, productionArgument].map((value) => resolve(value))
if (!databasePath || !expectedRoot || !productionRoot) throw new Error('Expected database, isolated root and production root paths.')
assert.equal(resolve(databasePath), resolve(expectedRoot, 'greekgod-v3.sqlite'))
assert.notEqual(expectedRoot.toLocaleLowerCase(), productionRoot.toLocaleLowerCase())
assert.ok(!expectedRoot.toLocaleLowerCase().startsWith(`${productionRoot.toLocaleLowerCase()}\\`))

const database = new DatabaseSync(databasePath, { readOnly: true })
try {
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  assert.equal(database.prepare('PRAGMA user_version').get().user_version, 8)
  const status = database.prepare('SELECT global_revision, bootstrap_state FROM sync_meta WHERE singleton_id = 1').get()
  assert.equal(status.bootstrap_state, expectedBootstrap)
  console.log(JSON.stringify({ databasePath, schemaVersion: 8, bootstrapState: status.bootstrap_state, revision: status.global_revision }))
} finally {
  database.close()
}
