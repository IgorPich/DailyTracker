import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExerciseDefinition, TemplateExercise, Workout, WorkoutExercise } from '../src/types.ts'
import { resolveTemplateExerciseId } from '../src/exerciseIdentity.ts'
import { previousExerciseOccurrence } from '../src/workoutData.ts'
import { compareExercises } from '../src/workoutProgress.ts'

const exerciseLibrary: ExerciseDefinition[] = [
  'bench-press',
  'incline-smith',
  'cable-fly',
  'cable-crunch',
  'machine-row',
  'custom-seal-row',
  'chest-supported-row',
  'dumbbell-lateral-raise',
  'lateral-raise-machine',
].map((id) => ({ id, name: `Definition ${id}`, equipmentSensitive: false }))

const previousOptions = (beforeOrOn: string, gymLocation?: string) => ({
  beforeOrOn,
  exerciseLibrary,
  gymLocation,
})

const exercise = (id: string, weight: number, reps: number, equipmentSensitive = false): WorkoutExercise => ({
  id: `${id}-occurrence`,
  exerciseId: id,
  name: id,
  prescription: '3 × 6–10',
  equipmentSensitive,
  sets: [{ id: `${id}-${weight}-${reps}`, weight, reps }],
})

const workout = (id: string, date: string, gymLocation: string, item: WorkoutExercise, templateCode: Workout['templateCode'] = 'A'): Workout => ({
  id,
  date,
  gymLocation,
  templateId: 'push',
  templateCode,
  templateName: templateCode === 'D' ? 'GRECKA GÓRA' : 'PUSH',
  exercises: [item],
})

test('free weight previous result crosses gyms and keeps exact exercise identity', () => {
  const bench = exercise('bench-press', 90, 6)
  const rows = [
    workout('older', '2026-08-01', 'Gym A', bench),
    workout('latest', '2026-08-08', 'Gym B', exercise('bench-press', 90, 7)),
    workout('different', '2026-08-09', 'Gym B', exercise('incline-smith', 100, 8, true)),
  ]
  const result = previousExerciseOccurrence(rows, bench, previousOptions('2026-08-10', 'Gym A'))
  assert.equal(result.latest?.workout.id, 'latest')
  assert.equal(result.comparable?.workout.id, 'latest')
})

test('equipment-sensitive previous result is restricted to the same gym', () => {
  const machine = exercise('cable-fly', 30, 10, true)
  const rows = [
    workout('same-gym', '2026-08-01', 'Gym A', machine),
    workout('other-gym', '2026-08-08', 'Gym B', exercise('cable-fly', 40, 10, true)),
  ]
  const result = previousExerciseOccurrence(rows, machine, previousOptions('2026-08-10', 'Gym A'))
  assert.equal(result.latest?.workout.id, 'other-gym')
  assert.equal(result.comparable?.workout.id, 'same-gym')
})

test('shared progress logic marks a real improvement positive', () => {
  const result = compareExercises(
    exercise('bench-press', 90, 7),
    exercise('bench-press', 90, 6),
    'Gym A',
    'Gym B',
  )
  assert.deepEqual(result, { label: '+1 powt.', tone: 'positive' })
})

test('progress tones distinguish regressions, neutral trade-offs, and warnings', () => {
  assert.equal(compareExercises(exercise('bench-press', 90, 7), exercise('bench-press', 90, 8)).tone, 'negative')
  assert.equal(compareExercises(exercise('bench-press', 90, 8), exercise('bench-press', 90, 8)).tone, 'neutral')
  assert.deepEqual(
    compareExercises(exercise('bench-press', 92.5, 7), exercise('bench-press', 90, 8)),
    { label: '+2.5 kg', tone: 'neutral' },
  )
  assert.deepEqual(
    compareExercises(exercise('bench-press', 92.5, 5), exercise('bench-press', 90, 8)),
    { label: 'większy ciężar, poza zakresem', tone: 'warning' },
  )
})

test('A → D → A selects the chronologically latest shared exercise session', () => {
  const reference = exercise('cable-crunch', 55, 10, true)
  const rows = [
    workout('session-a', '2026-08-01', 'Gym A', exercise('cable-crunch', 50, 10, true), 'A'),
    workout('session-d', '2026-08-08', 'Gym A', exercise('cable-crunch', 52.5, 10, true), 'D'),
  ]
  const result = previousExerciseOccurrence(rows, reference, previousOptions('2026-08-15', 'Gym A'))
  assert.equal(result.latest?.workout.id, 'session-d')
  assert.equal(result.comparable?.workout.id, 'session-d')
})

test('same machine in another gym is latest but never directly comparable', () => {
  const reference = exercise('machine-row', 70, 8, true)
  const rows = [workout('other-gym', '2026-08-08', 'Gym B', exercise('machine-row', 75, 8, true))]
  const result = previousExerciseOccurrence(rows, reference, previousOptions('2026-08-10', 'Gym A'))
  assert.equal(result.latest?.workout.id, 'other-gym')
  assert.equal(result.comparable, undefined)
})

test('custom exercise remains selectable by its stable exerciseId', () => {
  const reference = exercise('custom-seal-row', 60, 8)
  const rows = [workout('custom-session', '2026-08-08', 'Gym A', exercise('custom-seal-row', 57.5, 9))]
  assert.equal(previousExerciseOccurrence(rows, reference, previousOptions('2026-08-10', 'Gym A')).comparable?.workout.id, 'custom-session')
})

test('cable row and machine row never share history', () => {
  const rows = [workout('machine-session', '2026-08-08', 'Gym A', exercise('machine-row', 100, 9, true))]
  assert.equal(previousExerciseOccurrence(rows, exercise('chest-supported-row', 80, 8, true), previousOptions('2026-08-10', 'Gym A')).latest, undefined)
})

test('machine lateral raise and dumbbell lateral raise never share history', () => {
  const rows = [workout('dumbbell-session', '2026-08-08', 'Gym A', exercise('dumbbell-lateral-raise', 12, 12))]
  assert.equal(previousExerciseOccurrence(rows, exercise('lateral-raise-machine', 30, 12, true), previousOptions('2026-08-10', 'Gym A')).latest, undefined)
})

test('template replacement resolves the new exact identity without rewriting historical rows', () => {
  const library: ExerciseDefinition[] = [
    { id: 'chest-supported-row', name: 'Wiosło na wyciągu', equipmentSensitive: true },
    { id: 'machine-row', name: 'Wiosło na siedząco na maszynie', equipmentSensitive: true },
  ]
  const previous: TemplateExercise = {
    id: 'template-row',
    exerciseId: 'chest-supported-row',
    name: 'Wiosło na wyciągu',
    prescription: '3 × 6–10',
    defaultSets: 3,
    equipmentSensitive: true,
  }
  const edited = { ...previous, exerciseId: 'machine-row', name: 'Wiosło na siedząco na maszynie' }
  const resolvedId = resolveTemplateExerciseId(edited)
  assert.equal(resolvedId, 'machine-row')

  const history = [
    workout('cable-history', '2026-08-01', 'Gym A', exercise('chest-supported-row', 82, 9, true)),
    workout('machine-history', '2026-08-02', 'Gym A', exercise('machine-row', 100, 10, true)),
  ]
  const before = structuredClone(history)
  const reference = exercise(resolvedId!, 0, 0, true)
  const comparable = previousExerciseOccurrence(history, reference, {
    beforeOrOn: '2026-09-06',
    exerciseLibrary: library,
    gymLocation: 'Gym A',
  })
  assert.equal(comparable.latest?.workout.id, 'machine-history')
  assert.equal(comparable.comparable?.workout.id, 'machine-history')
  assert.deepEqual(history, before)
})

test('template rename never fuzzy-merges into another exercise identity', () => {
  const library: ExerciseDefinition[] = [
    { id: 'chest-supported-row', name: 'Wiosło na wyciągu', equipmentSensitive: true },
    { id: 'machine-row', name: 'Wiosło na siedząco na maszynie', equipmentSensitive: true },
  ]
  const previous: TemplateExercise = {
    id: 'template-row', exerciseId: 'chest-supported-row', name: 'Wiosło na wyciągu',
    prescription: '3 × 6–10', defaultSets: 3, equipmentSensitive: true,
  }
  assert.equal(resolveTemplateExerciseId({ ...previous, name: 'Wiosło siedzące maszyna' }), 'chest-supported-row')
})

test('same slot, similar names and aliases never merge distinct explicit identities', () => {
  const library: ExerciseDefinition[] = [
    { id: 'definition-a', name: 'Synthetic row', aliases: ['Synthetic machine row'], equipmentSensitive: true },
    { id: 'definition-b', name: 'Synthetic row machine', equipmentSensitive: true },
  ]
  const rows = [
    workout('history-a', '2026-08-01', 'Gym A', { ...exercise('definition-a', 50, 8, true), id: 'shared-slot', name: 'Synthetic row' }),
    workout('history-b', '2026-08-02', 'Gym A', { ...exercise('definition-b', 60, 8, true), id: 'shared-slot', name: 'Synthetic machine row' }),
  ]

  const result = previousExerciseOccurrence(
    rows,
    { ...exercise('definition-b', 0, 0, true), id: 'shared-slot', name: 'Synthetic row' },
    { beforeOrOn: '2026-08-03', exerciseLibrary: library, gymLocation: 'Gym A' },
  )

  assert.equal(result.latest?.workout.id, 'history-b')
  assert.equal(result.comparable?.workout.id, 'history-b')
})

test('missing, invalid and unknown identity is unresolved and excluded from history', () => {
  const library: ExerciseDefinition[] = [{ id: 'definition-a', name: 'Synthetic A', equipmentSensitive: false }]
  const missing = { ...exercise('unused-slot', 10, 10), exerciseId: undefined }
  const invalid = { ...exercise('unused-slot', 10, 10), exerciseId: ' definition-a ' }
  const unknown = { ...exercise('unknown', 10, 10), exerciseId: 'unknown' }

  for (const reference of [missing, invalid, unknown]) {
    const result = previousExerciseOccurrence(
      [workout('history', '2026-08-01', 'Gym A', reference)],
      reference,
      { beforeOrOn: '2026-08-02', exerciseLibrary },
    )
    assert.equal(result.latest, undefined)
    assert.equal(result.comparable, undefined)
    assert.equal(result.identityIssue, 'UNRESOLVED_EXERCISE_IDENTITY')
  }
})
