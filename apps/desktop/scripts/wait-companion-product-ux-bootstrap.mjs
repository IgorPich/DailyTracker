import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { basename, resolve } from 'node:path'

const [rootArgument, productionArgument, timeoutArgument = '60000'] = process.argv.slice(2)
if (!rootArgument || !productionArgument) throw new Error('Expected isolated and production AppData roots.')
const smokeRoot = resolve(rootArgument)
const productionRoot = resolve(productionArgument)
const timeoutMs = Number(timeoutArgument)
assert.equal(basename(smokeRoot).toLocaleLowerCase(), 'com.igorpich.formlog.schema8smoke')
assert.notEqual(smokeRoot.toLocaleLowerCase(), productionRoot.toLocaleLowerCase())
assert.ok(!smokeRoot.toLocaleLowerCase().startsWith(`${productionRoot.toLocaleLowerCase()}\\`))
assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000)

const databasePath = resolve(smokeRoot, 'greekgod-v3.sqlite')
const deadline = Date.now() + timeoutMs
let lastPendingReason = 'database is not ready'
let ready = false
while (Date.now() < deadline) {
  let database
  try {
    database = new DatabaseSync(databasePath, { readOnly: true })
    const userVersion = database.prepare('PRAGMA user_version').get().user_version
    if (userVersion !== 8) {
      if (userVersion !== 0) assert.equal(userVersion, 8)
      lastPendingReason = `schema version is ${userVersion}`
    } else {
      const row = database.prepare('SELECT data_version FROM app_data WHERE singleton_id = 1').get()
      const status = database.prepare('SELECT global_revision, bootstrap_state FROM sync_meta WHERE singleton_id = 1').get()
      if (!row) lastPendingReason = 'app_data row is missing'
      else if (!status) lastPendingReason = 'sync_meta row is missing'
      else if (status.bootstrap_state !== 'complete') lastPendingReason = `bootstrap state is ${status.bootstrap_state}`
      else {
        assert.equal(row.data_version, 4)
        console.log(JSON.stringify({ databasePath, schemaVersion: 8, dataVersion: 4, revision: status.global_revision, bootstrapState: status.bootstrap_state }))
        database.close()
        database = undefined
        ready = true
        break
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/unable to open database|no such table: (app_data|sync_meta)/i.test(message)) throw error
    lastPendingReason = message
  } finally {
    database?.close()
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
}
if (!ready) throw new Error(`Timed out waiting for isolated SQLite bootstrap: ${lastPendingReason}`)
