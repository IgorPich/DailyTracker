import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { buildCompanionProductContext, resolveCompanionProductEvidence } from '../src/services/companionProductContext.ts'

const [rootArgument, productionArgument, expectedPrescription = '3 × 5–7'] = process.argv.slice(2)
if (!rootArgument || !productionArgument) throw new Error('Expected isolated and production AppData roots.')
const smokeRoot = resolve(rootArgument)
const productionRoot = resolve(productionArgument)
assert.equal(basename(smokeRoot).toLocaleLowerCase(), 'com.igorpich.formlog.schema8smoke')
assert.notEqual(smokeRoot.toLocaleLowerCase(), productionRoot.toLocaleLowerCase())
assert.ok(!smokeRoot.toLocaleLowerCase().startsWith(`${productionRoot.toLocaleLowerCase()}\\`))

const fixture = JSON.parse(await readFile(resolve(smokeRoot, 'companion-ux-smoke-fixture.json'), 'utf8'))
assert.equal(fixture.syntheticOnly, true)
const database = new DatabaseSync(resolve(smokeRoot, 'greekgod-v3.sqlite'), { readOnly: true })
let appData
let revision
try {
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  assert.equal(database.prepare('PRAGMA user_version').get().user_version, 8)
  const row = database.prepare('SELECT data_version, payload_json FROM app_data WHERE singleton_id = 1').get()
  assert.equal(row.data_version, 4)
  appData = JSON.parse(row.payload_json)
  const status = database.prepare('SELECT global_revision, bootstrap_state FROM sync_meta WHERE singleton_id = 1').get()
  assert.equal(status.bootstrap_state, 'complete')
  revision = status.global_revision
} finally {
  database.close()
}
assert.equal(appData.workouts.length, fixture.expectedWorkoutCount30Days)
assert.equal(appData.workouts.reduce((sum, workout) => sum + workout.duration, 0), fixture.expectedDurationMinutes30Days)
assert.equal(appData.templates.length, 1)
assert.equal(appData.templates[0].exercises.length, 1)
assert.equal(appData.templates[0].exercises[0].prescription, expectedPrescription)

const coachEnvelope = JSON.parse(await readFile(resolve(smokeRoot, 'greekgod-human-coach.dev.v1.json'), 'utf8'))
const memoryEnvelope = JSON.parse(await readFile(resolve(smokeRoot, 'greekgod-companion-memory.dev.v1.json'), 'utf8'))
const sources = {
  readHumanCoach: async () => coachEnvelope.context,
  readMemory: async () => memoryEnvelope.memory,
}
const contexts = await Promise.all([
  buildCompanionProductContext(fixture.analyticsQuestion, appData, sources, '2026-09-17', '2026-09-17T12:00:00.000Z'),
  buildCompanionProductContext(fixture.memoryQuestion, appData, sources, '2026-09-17', '2026-09-17T12:00:00.000Z'),
  buildCompanionProductContext(fixture.humanCoachQuestion, appData, sources, '2026-09-17', '2026-09-17T12:00:00.000Z'),
])
for (const context of contexts) {
  context.evidence.forEach((item, index) => assert.equal(item.id, `evidence-${index + 1}`))
  const visible = JSON.stringify({
    evidence: context.evidence,
    displayKeys: Object.keys(context.evidenceDisplay),
    rendered: resolveCompanionProductEvidence(context, context.evidence.map((item) => item.id)),
  })
  for (const privateId of fixture.privateIdsNeverVisible) assert.ok(!visible.includes(privateId))
}
assert.match(contexts[0].evidence[0].text, /3 treningów/)
assert.match(contexts[0].evidence[0].text, /120 min/)
assert.match(contexts[1].evidence[0].text, /krótkie podsumowania/)
assert.match(contexts[2].evidence[0].text, /spokojna technika/)
assert.deepEqual(resolveCompanionProductEvidence(contexts[2], ['evidence-stale-forged']), [])

console.log(JSON.stringify({
  smokeRoot,
  schemaVersion: 8,
  appDataVersion: 4,
  revision,
  syntheticWorkouts: appData.workouts.length,
  expectedPrescription,
  evidenceHandles: contexts.map((context) => context.evidence.map((item) => item.id)),
  persistenceIdsExposed: false,
}))
