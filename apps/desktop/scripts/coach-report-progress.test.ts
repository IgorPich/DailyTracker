import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compareExercises, type AppData, type Workout } from '@greekgod/core'
import { reportSelection } from '@greekgod/analytics'
import { coachReportSelection } from '../src/adapters/coachReportSelection.ts'

type Snapshot = Pick<AppData, 'exerciseLibrary' | 'workouts' | 'templates'>
const from = '2026-02-01'
const asOf = '2026-02-28'
const workout = (id: string, date: string, reps: number[], weight = 20, gymLocation = 'synthetic-room'): Workout => ({
  id: randomUUID(), date, gymLocation, templateId: randomUUID(), templateCode: 'A', templateName: 'Fixture',
  exercises: [{ id: randomUUID(), exerciseId: id, name: 'Shared name', prescription: '2 × 6–10',
    sets: reps.map((reps) => ({ id: randomUUID(), weight, reps })) }],
})
const snapshot = (id: string, workouts: Workout[], sensitive = false): Snapshot => ({
  exerciseLibrary: [{ id, name: 'Shared name', aliases: ['Shared alias'], equipmentSensitive: sensitive }],
  templates: [{ id: randomUUID(), code: 'A', name: 'Fixture', exercises: [
    { id: randomUUID(), exerciseId: id, name: 'Shared name', defaultSets: 2, prescription: '2 × 6–10' },
  ] }], workouts,
})
const select = (data: Snapshot) => {
  const before = structuredClone(data)
  const raw = reportSelection({ snapshot: data, recentFrom: from, asOf })
  const result = coachReportSelection(data, from, asOf)
  assert.deepEqual(data, before)
  assert.deepEqual(result.selectedExercises.map((x) => x.progress), raw.selectedExercises.map((x) => x.progress))
  assert.deepEqual(result.selectedExercises.map((x) => x.ranking), raw.selectedExercises.map((x) => x.ranking))
  assert.deepEqual(result, coachReportSelection(data, from, asOf))
  return result.selectedExercises[0]
}

for (const [name, current, expectedStatus, expectedTone, expectedLabel] of [
  ['full progress', [9, 9], 'PROGRESS', 'positive', 'Progres'],
  ['full regression', [7, 7], 'REGRESSION', 'negative', 'Regres'],
  ['true stable', [8, 8], 'FLAT', 'neutral', 'Bez zmian'],
  ['mixed', [9, 7], 'FLAT', 'neutral', 'Wyniki mieszane'],
] as const) {
  test(`${name}: generated identity uses the full Analytics verdict`, () => {
    const id = randomUUID()
    const row = select(snapshot(id, [workout(id, '2026-02-20', [...current]), workout(id, '2026-02-10', [8, 8])]))
    assert.equal(row.exerciseId, id)
    assert.equal(row.progress.status, expectedStatus)
    assert.deepEqual(row.change, { tone: expectedTone, label: expectedLabel })
  })
}

test('improving best set cannot override mixed full-exposure performance', () => {
  const id = randomUUID()
  const current = workout(id, '2026-02-20', [9, 7])
  const previous = workout(id, '2026-02-10', [8, 8])
  assert.equal(compareExercises(current.exercises[0], previous.exercises[0]).tone, 'positive')
  const row = select(snapshot(id, [current, previous]))
  assert.equal(row.currentSet?.reps, 9)
  assert.equal(row.previousSet?.reps, 8)
  assert.equal(row.progress.status, 'FLAT')
  assert.equal(row.change.tone, 'neutral')
  assert.equal(row.change.label, 'Wyniki mieszane')
})

test('declining best set cannot override non-directional set-count change', () => {
  const id = randomUUID()
  const current = workout(id, '2026-02-20', [7])
  const previous = workout(id, '2026-02-10', [8, 8])
  assert.equal(compareExercises(current.exercises[0], previous.exercises[0]).tone, 'negative')
  const row = select(snapshot(id, [current, previous]))
  assert.equal(row.currentSet?.reps, 7)
  assert.equal(row.previousSet?.reps, 8)
  assert.equal(row.progress.status, 'FLAT')
  assert.ok(row.progress.reasonCodes.includes('SET_COUNT_CHANGED'))
  assert.equal(row.change.tone, 'neutral')
})

test('trade-off FLAT is explicitly non-directional', () => {
  const id = randomUUID()
  const row = select(snapshot(id, [workout(id, '2026-02-20', [10], 15), workout(id, '2026-02-10', [8])]))
  assert.equal(row.progress.status, 'FLAT')
  assert.ok(row.progress.reasonCodes.includes('PERFORMANCE_TRADE_OFF'))
  assert.deepEqual(row.change, { label: 'Kompromis ciężar / powtórzenia', tone: 'neutral' })
})

test('different equipment context never receives a directional verdict', () => {
  const id = randomUUID()
  const row = select(snapshot(id, [workout(id, '2026-02-20', [10], 25, 'room-one'), workout(id, '2026-02-10', [8])], true))
  assert.equal(row.progress.status, 'NOT_COMPARABLE')
  assert.deepEqual(row.change, { label: 'Inny kontekst sprzętu', tone: 'neutral' })
  assert.ok(row.currentSet && row.previousSet)
})

test('missing equipment context is informational', () => {
  const id = randomUUID()
  const row = select(snapshot(id, [workout(id, '2026-02-20', [10], 25, ''), workout(id, '2026-02-10', [8])], true))
  assert.equal(row.progress.status, 'NOT_COMPARABLE')
  assert.deepEqual(row.change, { label: 'Brak kontekstu siłowni', tone: 'neutral' })
})

test('single or absent exposure remains insufficient, not a new progress claim', () => {
  const id = randomUUID()
  for (const workouts of [[], [workout(id, '2026-02-20', [8])]]) {
    const row = select(snapshot(id, workouts))
    assert.equal(row.progress.status, 'INSUFFICIENT_DATA')
    assert.equal(row.change.tone, 'neutral')
    assert.equal(row.previousSet, undefined)
  }
})

test('same name and alias with different generated IDs remain independent', () => {
  const first = randomUUID()
  const second = randomUUID()
  const a = snapshot(first, [workout(first, '2026-02-20', [9]), workout(first, '2026-02-10', [8])])
  const b = snapshot(second, [workout(second, '2026-02-20', [7]), workout(second, '2026-02-10', [8])])
  const result = coachReportSelection({ exerciseLibrary: [...a.exerciseLibrary, ...b.exerciseLibrary],
    templates: [...a.templates, ...b.templates], workouts: [...a.workouts, ...b.workouts] }, from, asOf)
  assert.equal(result.selectedExercises.length, 2)
  assert.equal(result.selectedExercises.find((x) => x.exerciseId === first)?.change.tone, 'positive')
  assert.equal(result.selectedExercises.find((x) => x.exerciseId === second)?.change.tone, 'negative')
})

test('displayed previous facts come from the classifier-selected older comparable exposure', () => {
  const id = randomUUID()
  const current = workout(id, '2026-02-20', [9])
  const skipped = workout(id, '2026-02-15', [10], 50, 'other-room')
  const comparison = workout(id, '2026-02-10', [8])
  const row = select(snapshot(id, [current, skipped, comparison], true))
  assert.equal(row.progress.status, 'PROGRESS')
  assert.equal(row.previous?.workout.id, comparison.id)
  assert.equal(row.previous?.workout.id, row.progress.evidence.comparisonWorkoutId)
  assert.equal(row.previousSet?.id, comparison.exercises[0].sets[0].id)
  assert.equal(row.current?.workout.id, row.progress.evidence.currentWorkoutId)
})

test('CoachReport uses the adapter for both visible and copied verdicts without rescanning', () => {
  const source = readFileSync(new URL('../src/pages/CoachReport.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /compareExercises|compareSets|getBestSet|exerciseOccurrencesByWorkout|exerciseProgressClassification|exerciseExposureHistory/)
  assert.match(source, /coachReportSelection\(data, range.from, range.to\)/)
  assert.match(source, /change-pill--\$\{row.change.tone\}/)
  assert.match(source, /\{row.change.label\}<\/span>/)
  assert.match(source, /\$\{row.change.label\}/)
})
