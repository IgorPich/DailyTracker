import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ExerciseDefinition, TrainingTemplate, Workout } from '@greekgod/core'
import { reportSelection, type ReportSelectionQuery } from '../src/index.ts'

const definition = (id: string): ExerciseDefinition => ({ id, name: 'Same display name', equipmentSensitive: false })
const template = (ids: string[]): TrainingTemplate => ({ id: 'template', code: 'D', name: 'Template',
  exercises: ids.map((exerciseId, i) => ({ id: `slot-${i}`, exerciseId, name: 'Stale label', prescription: '2 × 6–10', defaultSets: 2 })) })
const workout = (exerciseId: string, date: string, reps: number[], weight = 20, gym = 'synthetic-room'): Workout => ({
  id: `${exerciseId}-${date}`, date, templateId: 'template', templateCode: 'B', templateName: 'Snapshot', gymLocation: gym,
  exercises: [{ id: `${exerciseId}-slot`, exerciseId, name: 'Old label', prescription: '2 × 6–10',
    sets: reps.map((r, i) => ({ id: `${exerciseId}-${date}-${i}`, weight, reps: r })) }],
})
const query = (ids: string[], active: string[] = ids, workouts: Workout[] = []): ReportSelectionQuery => ({
  asOf: '2026-02-28', recentFrom: '2026-02-01',
  snapshot: { exerciseLibrary: ids.map(definition), templates: [template(active)], workouts },
})
const pair = (id: string, current: number[], previous = [8, 8]) => [
  workout(id, '2026-02-20', current), workout(id, '2026-01-20', previous),
]

test('recent active runtime-generated exercise is selected with exact evidence and version', () => {
  const id = randomUUID()
  const result = reportSelection(query([id], [id], pair(id, [9, 9])))
  const selected = result.selectedExercises[0]
  assert.equal(result.reportSelectionVersion, 'report-selection-v1')
  assert.equal(selected.exerciseId, id)
  assert.deepEqual(selected.selectionReasons, ['RECENT_EXPOSURE', 'ACTIVE_TEMPLATE', 'MEANINGFUL_CHANGE'])
  assert.equal(selected.progress.status, 'PROGRESS')
  assert.deepEqual(selected.evidence.activeTemplateIds, ['template'])
  assert.deepEqual(selected.evidence.recentExposures[0].setIds, [`${id}-2026-02-20-0`, `${id}-2026-02-20-1`])
})

test('universe is active references union recent valid exposures, not the whole library', () => {
  const q = query(['active', 'recent', 'inactive', 'old', 'future'], ['active'], [
    workout('recent', '2026-02-01', [8]), workout('old', '2026-01-31', [8]), workout('future', '2026-03-01', [8]),
  ])
  const result = reportSelection(q)
  assert.deepEqual(new Set(result.selectedExercises.map((x) => x.exerciseId)), new Set(['active', 'recent']))
  assert.equal(result.selectedExercises.find((x) => x.exerciseId === 'active')!.progress.status, 'INSUFFICIENT_DATA')
  assert.equal(result.excludedExercises.length, 3)
})

test('regression then mixed FLAT then progress outrank benign FLAT', () => {
  const q = query(['stable', 'progress', 'mixed', 'regression'], undefined, [
    ...pair('stable', [8, 8]), ...pair('progress', [9, 9]), ...pair('mixed', [9, 7]), ...pair('regression', [7, 7]),
  ])
  const result = reportSelection(q)
  assert.deepEqual(result.selectedExercises.map((x) => x.exerciseId), ['regression', 'mixed', 'progress', 'stable'])
  const mixed = result.selectedExercises[1]
  assert.equal(mixed.progress.status, 'FLAT')
  assert.ok(mixed.progress.reasonCodes.includes('MIXED_SET_PERFORMANCE'))
  assert.ok(mixed.selectionReasons.includes('NEEDS_ATTENTION'))
  assert.ok(!result.selectedExercises[3].selectionReasons.includes('NEEDS_ATTENTION'))
})

test('trade-off FLAT and changed set counts are distinguished from equivalent FLAT', () => {
  const q = query(['trade', 'count'], undefined, [
    workout('trade', '2026-02-20', [10], 15), workout('trade', '2026-01-20', [8], 20),
    ...pair('count', [8], [8, 8]),
  ])
  for (const selected of reportSelection(q).selectedExercises) {
    assert.equal(selected.progress.status, 'FLAT')
    assert.equal(selected.ranking.priority, 'RECENT_MIXED_OR_TRADE_OFF')
    assert.ok(selected.selectionReasons.includes('NEEDS_ATTENTION'))
  }
})

test('single exposure explicitly reports insufficient comparable history', () => {
  const result = reportSelection(query(['new'], [], [workout('new', '2026-02-20', [8])])).selectedExercises[0]
  assert.equal(result.progress.status, 'INSUFFICIENT_DATA')
  assert.ok(result.selectionReasons.includes('INSUFFICIENT_COMPARABLE_HISTORY'))
  assert.ok(!result.selectionReasons.includes('MEANINGFUL_CHANGE'))
})

test('different gym equipment is NOT_COMPARABLE and never a directional change', () => {
  const q = query(['sensitive'], [], [workout('sensitive', '2026-02-20', [10], 25, 'one'), workout('sensitive', '2026-01-20', [8], 20, 'two')])
  q.snapshot.exerciseLibrary[0].equipmentSensitive = true
  const selected = reportSelection(q).selectedExercises[0]
  assert.equal(selected.progress.status, 'NOT_COMPARABLE')
  assert.ok(selected.selectionReasons.includes('INSUFFICIENT_COMPARABLE_HISTORY'))
  assert.ok(!selected.selectionReasons.includes('MEANINGFUL_CHANGE'))
})

test('same-name and alias collisions remain independent; repeated template slots deduplicate exact IDs', () => {
  const q = query(['second-id', 'first-id'], ['first-id', 'second-id', 'first-id'])
  q.snapshot.exerciseLibrary[1].aliases = ['Same display name']
  assert.deepEqual(reportSelection(q).selectedExercises.map((x) => x.exerciseId), ['second-id', 'first-id'])
})

test('identical input is deterministic and immutable; tie-breaker is source order, not ID or name', () => {
  const q = query(['z', 'a'])
  const before = structuredClone(q)
  const first = reportSelection(q)
  assert.deepEqual(first, reportSelection(q))
  assert.deepEqual(q, before)
  assert.deepEqual(first.selectedExercises.map((x) => x.ranking.sourceOrder), [0, 1])
  q.snapshot.exerciseLibrary[0].name = 'Z renamed'
  q.snapshot.exerciseLibrary[1].name = 'A renamed'
  assert.deepEqual(reportSelection(q).selectedExercises.map((x) => x.exerciseId), ['z', 'a'])
})

test('recency then active membership break equal-priority ties before source order', () => {
  const q = query(['older', 'inactive', 'active'], ['active'], [
    workout('older', '2026-02-01', [8]), workout('inactive', '2026-02-20', [8]), workout('active', '2026-02-20', [8]),
  ])
  assert.deepEqual(reportSelection(q).selectedExercises.map((x) => x.exerciseId), ['active', 'inactive', 'older'])
})

test('display limit is applied after evaluation; default includes all active references', () => {
  const ids = Array.from({ length: 30 }, () => randomUUID())
  const q = query(ids)
  assert.equal(reportSelection(q).selectedExercises.length, 30)
  const result = reportSelection({ ...q, limit: 2 })
  assert.equal(result.eligibleExerciseCount, 30)
  assert.equal(result.selectedExercises.length, 2)
  assert.equal(result.excludedExercises.filter((x) => x.reason === 'DISPLAY_LIMIT').length, 28)
  assert.equal(reportSelection({ ...q, limit: 0 }).selectedExercises.length, 0)
})

test('unresolved refs cannot fall back to slots and duplicate library IDs are excluded', () => {
  const q = query(['valid', 'duplicate'], [], [workout('valid', '2026-02-20', [8])])
  q.snapshot.exerciseLibrary = [...q.snapshot.exerciseLibrary, definition('duplicate')]
  q.snapshot.workouts[0].exercises[0].id = 'valid'
  q.snapshot.workouts[0].exercises[0].exerciseId = undefined
  q.snapshot.templates = [template(['duplicate', 'unknown', ' valid '])]
  assert.deepEqual(reportSelection(q).selectedExercises, [])
  assert.ok(reportSelection(q).excludedExercises.some((x) => x.reason === 'UNRESOLVED_EXERCISE_IDENTITY'))
})

test('empty, skipped and partial-only history cannot qualify an inactive exercise', () => {
  const q = query(['partial', 'skipped', 'empty'], [], [workout('partial', '2026-02-20', [8]), workout('skipped', '2026-02-20', [8]), workout('empty', '2026-02-20', [])])
  q.snapshot.workouts[0].exercises[0].sets[0].reps = undefined
  q.snapshot.workouts[1].exercises[0].skipped = true
  assert.equal(reportSelection(q).selectedExercises.length, 0)
})

test('stale regression is not promoted as a recent attention signal', () => {
  const q = query(['stale'], ['stale'], [workout('stale', '2026-01-20', [6]), workout('stale', '2026-01-19', [8])])
  const selected = reportSelection(q).selectedExercises[0]
  assert.equal(selected.progress.status, 'REGRESSION')
  assert.equal(selected.ranking.priority, 'ACTIVE_TEMPLATE_ONLY')
  assert.deepEqual(selected.selectionReasons, ['ACTIVE_TEMPLATE'])
})

test('validates dates and limits without using wall-clock time', () => {
  for (const q of [{ ...query([]), asOf: '2026-02-30' }, { ...query([]), recentFrom: '2026-03-01' }, { ...query([]), limit: -1 }]) {
    assert.throws(() => reportSelection(q), RangeError)
  }
})
