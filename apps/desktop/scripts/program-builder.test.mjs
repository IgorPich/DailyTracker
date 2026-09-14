import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const core = await server.ssrLoadModule('@greekgod/core')
  const { createInitialData, normalizeData } = await server.ssrLoadModule('/src/utils/storage.ts')
  const { reportSelection, exerciseExposureHistory } = await server.ssrLoadModule('@greekgod/analytics')
  const { coachReportSelection } = await server.ssrLoadModule('/src/adapters/coachReportSelection.ts')
  const { commandCandidates } = await server.ssrLoadModule('../../packages/companion/src/commands/explicitCommand.ts')
  const { nextTemplate, createWorkoutFromTemplate } = await server.ssrLoadModule('../mobile/src/domain/mobileModel.ts')
  const { INITIAL_MOBILE_DATA } = await server.ssrLoadModule('../mobile/src/data/initialData.ts')

  const seed = createInitialData()
  assert.deepEqual(seed.templates, core.DESKTOP_DEFAULT_TEMPLATES)
  assert.deepEqual(seed.templates.map((t) => t.code), ['A', 'B', 'C', 'D'])
  assert.deepEqual(normalizeData(structuredClone(seed)).templates, seed.templates)
  assert.deepEqual(INITIAL_MOBILE_DATA.templates, core.DEFAULT_TEMPLATES)
  const unchanged = structuredClone(seed)
  const cancelled = core.openProgramDraft(seed.templates)
  cancelled.templates.reverse(); cancelled.templates[0].name = 'Discarded'
  assert.deepEqual(seed, unchanged)

  const data = { ...seed, templates: [], exerciseLibrary: [], workouts: [] }
  for (let i = 0; i < 8; i++) {
    const definition = { id: randomUUID(), name: 'Same display name', equipmentSensitive: false }
    const template = { id: randomUUID(), code: `Custom ${i}`, name: `Dowolny trening ${i}`, exercises: [
      { id: randomUUID(), exerciseId: definition.id, name: definition.name, defaultSets: 2, prescription: '2 × 6–10' },
    ] }
    data.exerciseLibrary.push(definition); data.templates.push(template)
    for (const date of ['2026-01-10', '2026-01-20']) data.workouts.push({ id: randomUUID(), date,
      templateId: template.id, templateCode: template.code, templateName: template.name,
      exercises: [{ ...template.exercises[0], sets: [{ id: randomUUID(), weight: 20, reps: 8 }, { id: randomUUID(), weight: 20, reps: 8 }] }],
    })
  }
  core.validateProgram(data.templates, data.exerciseLibrary)
  assert.deepEqual(normalizeData(structuredClone(data)).templates, data.templates)
  const before = structuredClone(data)
  const args = { snapshot: data, recentFrom: '2026-01-01', asOf: '2026-01-31' }
  const raw = reportSelection(args)
  const report = coachReportSelection(data, args.recentFrom, args.asOf)
  assert.equal(raw.selectedExercises.length, 8)
  assert.deepEqual(report.selectedExercises.map((x) => x.exerciseId), raw.selectedExercises.map((x) => x.exerciseId))
  for (const definition of data.exerciseLibrary) {
    assert.ok(raw.selectedExercises.some((x) => x.exerciseId === definition.id))
    const history = exerciseExposureHistory({ snapshot: data, exerciseId: definition.id, asOf: args.asOf })
    assert.equal(history.exposures.length, 2)
  }
  const candidates = commandCandidates(data)
  assert.equal(candidates.length, 8)
  assert.deepEqual(candidates.map((x) => x.templateId), data.templates.map((t) => t.id))
  // Same shared native JSON projection received by Mobile, with no four-template shortlist.
  const received = JSON.parse(JSON.stringify(data))
  for (let i = 0; i < 8; i++) {
    const previous = createWorkoutFromTemplate(received.templates[i], received, '2026-02-01')
    assert.deepEqual(nextTemplate({ templates: received.templates, workouts: [previous] }), received.templates[(i + 1) % 8])
    assert.equal(previous.exercises[0].exerciseId, received.templates[i].exercises[0].exerciseId)
    assert.equal(previous.templateName, received.templates[i].name)
  }
  assert.deepEqual(data, before)

  // UI wiring guards complement pure-domain and native/coordinator concurrency tests.
  const builder = readFileSync(new URL('../src/pages/ProgramBuilder.tsx', import.meta.url), 'utf8')
  const settings = readFileSync(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8')
  assert.match(settings, /Edytuj program/)
  assert.match(builder, /useState\(\(\) => openProgramDraft\(data.templates\)\)/)
  assert.equal((builder.match(/programPersistence\.saveProgram\(/g) ?? []).length, 1)
  assert.doesNotMatch(builder, /useEffect|replaceAppData|updateTemplate|registerExerciseDefinition/)
  assert.match(builder, /onClick=\{onClose\}/)
  assert.match(builder, /await confirmAction\('Usunięcie treningu z programu nie usuwa zapisanej historii/)
  assert.match(builder, /exerciseId: definition\.id/)
  assert.match(builder, /draggable=\{!locked\}/)
  assert.match(builder, /onDrop=/)
  console.log('PASS Program Builder: seeds/cancel; 8-template Analytics, CoachReport, Companion, Mobile; UI wiring')
} finally { await server.close() }
