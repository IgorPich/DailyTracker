import { strictEqual } from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

const [databasePath] = process.argv.slice(2)
if (!databasePath) throw new Error('Expected isolated authority database path.')
const database = new DatabaseSync(databasePath, { readOnly: true })
try {
  strictEqual(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  const meta = database.prepare(`
    SELECT global_revision, materialized_revision, bootstrap_state
    FROM sync_meta WHERE singleton_id = 1
  `).get()
  strictEqual(meta.bootstrap_state, 'complete')
  strictEqual(meta.materialized_revision, meta.global_revision)
  strictEqual(database.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT entity_id FROM sync_entities
      WHERE entity_type = 'daily_entry' AND deleted_at IS NULL
      GROUP BY entity_id HAVING COUNT(*) > 1
    )
  `).get().count, 0)
  strictEqual(database.prepare(`
    SELECT deleted_at IS NOT NULL AS deleted FROM sync_entities
    WHERE entity_type = 'workout' AND entity_id = 'live-service-workout'
  `).get().deleted, 1)
  strictEqual(database.prepare(`
    SELECT deleted_at IS NULL AS active FROM sync_entities
    WHERE entity_type = 'workout' AND entity_id = 'live-closed-workout'
  `).get().active, 1)
  const desktopOutbox = database.prepare(`
    SELECT COUNT(*) AS count FROM sync_outbox
    WHERE (entity_type = 'daily_entry' AND entity_id = '2026-08-26')
       OR (entity_type = 'workout' AND entity_id = 'sqlite-smoke-workout')
  `).get().count
  if (desktopOutbox < 2) throw new Error('Desktop authority edits are missing from the outbox.')
  console.log(`PASS shared authority audit — revision ${meta.global_revision}, mirror equivalent, DailyEntry unique, tombstone durable, Desktop outbox present`)
} finally {
  database.close()
}
