import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { applyProgram, duplicateProgramTemplate, openProgramDraft, programVersion, reorderProgramItems, validateProgram } from '../src/program.ts'
import { replaceTemplateExerciseDefinition } from '../src/templateOperations.ts'
import type { AppData, TrainingTemplate } from '../src/types.ts'

const fixture = () => {
  const definition = { id: randomUUID(), name: 'Shared display name', equipmentSensitive: false }
  const other = { ...definition, id: randomUUID() }
  const template: TrainingTemplate = { id: randomUUID(), code: 'Dowolna etykieta', name: 'User program', exercises: [
    { id: randomUUID(), exerciseId: definition.id, name: definition.name, prescription: '1 × 4–6 + 2 × 6–8', defaultSets: 3 },
    { id: randomUUID(), exerciseId: other.id, name: other.name, prescription: '3 × 8', defaultSets: 3 },
  ] }
  const data: AppData = { version: 4, templates: [template], exerciseLibrary: [definition, other], dailyEntries: [], coachNotes: {},
    settings: { phase: 'Maintenance', calorieTarget: 2500, proteinTarget: 150, trendThresholds: { lossBelow: -0.15, stableUpper: 0.05, slowGainUpper: 0.2 } },
    workouts: [{ id: randomUUID(), date: '2026-01-01', templateId: template.id, templateCode: template.code, templateName: template.name,
      exercises: template.exercises.map((slot) => ({ ...slot, sets: [{ id: randomUUID(), weight: 20, reps: 8 }] })) }],
  }
  return data
}

test('sandbox edits/discard are detached; 1, 5 and 8 arbitrary templates apply only on explicit save', () => {
  const data = fixture(), before = structuredClone(data)
  const discarded = openProgramDraft(data.templates)
  discarded.templates[0].name = 'Discarded'
  assert.deepEqual(data, before)
  const plan = openProgramDraft(data.templates)
  for (let i = 1; i < 8; i++) plan.templates.push(duplicateProgramTemplate(plan.templates[0], randomUUID))
  validateProgram(plan.templates.slice(0, 5), data.exerciseLibrary)
  plan.templates[7].name = 'Ósmy — arbitrary name'
  plan.templates = reorderProgramItems(plan.templates, 7, 0)
  const saved = applyProgram(data, plan)
  assert.equal(saved.templates.length, 8)
  assert.equal(saved.templates[0].name, 'Ósmy — arbitrary name')
  assert.deepEqual(data, before)
  assert.equal(saved.workouts, data.workouts)
  assert.equal(saved.exerciseLibrary, data.exerciseLibrary)
  assert.equal(saved.settings, data.settings)
  assert.equal(saved.dailyEntries, data.dailyEntries)
  assert.deepEqual(saved.templates, plan.templates)
  assert.notEqual(saved.templates, plan.templates)
})

test('duplicate gets new template/slot IDs, reuses definitions; rename/delete/reorder/replace never rewrite history', () => {
  const data = fixture(), before = structuredClone(data)
  const plan = openProgramDraft(data.templates)
  const copy = duplicateProgramTemplate(plan.templates[0], randomUUID)
  assert.notEqual(copy.id, data.templates[0].id)
  copy.exercises.forEach((slot, i) => {
    assert.notEqual(slot.id, data.templates[0].exercises[i].id)
    assert.deepEqual({ ...slot, id: data.templates[0].exercises[i].id }, data.templates[0].exercises[i])
  })
  plan.templates.push(copy)
  plan.templates[0].name = 'Renamed'
  assert.equal(plan.templates[0].id, data.templates[0].id)
  plan.templates[0].exercises = replaceTemplateExerciseDefinition(plan.templates[0].exercises, plan.templates[0].exercises[0].id, data.exerciseLibrary[1])
  assert.equal(plan.templates[0].exercises[0].exerciseId, data.exerciseLibrary[1].id)
  assert.equal(copy.exercises[0].exerciseId, data.exerciseLibrary[0].id)
  copy.exercises = reorderProgramItems(copy.exercises, 1, 0)
  plan.templates = [copy]
  const saved = applyProgram(data, plan)
  assert.deepEqual(saved.workouts, before.workouts)
  assert.deepEqual(saved.exerciseLibrary, before.exerciseLibrary)
  assert.deepEqual(data, before)
})

test('baseline ignores object-key order and unrelated data, but binds every program field and array order', () => {
  const data = fixture(), plan = openProgramDraft(data.templates)
  const reorderedKeys = JSON.parse(JSON.stringify(data.templates, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v))
  assert.equal(programVersion(reorderedKeys), plan.baseline)
  assert.doesNotThrow(() => applyProgram({ ...data, dailyEntries: [{ id: randomUUID(), date: '2026-01-02', weight: 80 }] }, plan))
  for (const change of [
    (t: TrainingTemplate) => { t.name += ' changed' },
    (t: TrainingTemplate) => { t.code += ' changed' },
    (t: TrainingTemplate) => { t.exercises.reverse() },
    (t: TrainingTemplate) => { t.exercises[0].prescription = '4 × 5' },
    (t: TrainingTemplate) => { t.exercises[0].exerciseId = data.exerciseLibrary[1].id },
  ]) {
    const current = structuredClone(data); change(current.templates[0])
    assert.throws(() => applyProgram(current, plan), /STALE_PROGRAM/)
  }
})

test('validation rejects malformed drafts and unresolved exact IDs without name/alias/slot fallback', () => {
  const data = fixture()
  for (const mutate of [
    (ts: TrainingTemplate[]) => { ts.length = 0 },
    (ts: TrainingTemplate[]) => { ts.push(structuredClone(ts[0])) },
    (ts: TrainingTemplate[]) => { ts[0].name = ' ' },
    (ts: TrainingTemplate[]) => { ts[0].exercises[1].id = ts[0].exercises[0].id },
    (ts: TrainingTemplate[]) => { ts[0].exercises[0].exerciseId = undefined },
    (ts: TrainingTemplate[]) => { ts[0].exercises[0].exerciseId = data.exerciseLibrary[0].name },
    (ts: TrainingTemplate[]) => { ts[0].exercises[0].exerciseId = ts[0].exercises[0].id },
    (ts: TrainingTemplate[]) => { ts[0].exercises[0].prescription = '' },
    (ts: TrainingTemplate[]) => { ts[0].exercises[0].defaultSets = NaN },
    (ts: TrainingTemplate[]) => { ts[0].exercises[0].defaultSets = 0 },
  ]) {
    const plan = openProgramDraft(data.templates); mutate(plan.templates)
    assert.throws(() => validateProgram(plan.templates, data.exerciseLibrary))
  }
  assert.throws(() => validateProgram(data.templates, [...data.exerciseLibrary, data.exerciseLibrary[0]]))
  assert.doesNotThrow(() => validateProgram([{ ...data.templates[0], exercises: [] }], data.exerciseLibrary))
})
