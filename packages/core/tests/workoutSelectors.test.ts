import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppData, ExerciseDefinition, TemplateExercise, Workout, WorkoutExercise } from '../src/types.ts'
import { auditExerciseIdentities } from '../src/exerciseIdentityAudit.ts'
import { resolveTemplateExerciseId, UNRESOLVED_EXERCISE_IDENTITY } from '../src/exerciseIdentity.ts'
import { previousExerciseOccurrence as selectPreviousExerciseOccurrence } from '../src/workoutData.ts'
import { compareExercises } from '../src/workoutProgress.ts'

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

const libraryFor = (workouts: Workout[], reference: WorkoutExercise): ExerciseDefinition[] => {
  const definitions = new Map<string, ExerciseDefinition>()
  for (const item of [reference, ...workouts.flatMap((workout) => workout.exercises)]) {
    if (!item.exerciseId || definitions.has(item.exerciseId)) continue
    definitions.set(item.exerciseId, {
      id: item.exerciseId,
      name: item.name,
      equipmentSensitive: Boolean(item.equipmentSensitive),
    })
  }
  return [...definitions.values()]
}

const previousExerciseOccurrence = (
  workouts: Workout[],
  reference: WorkoutExercise,
  beforeOrOn: string,
  gymLocation?: string,
) => selectPreviousExerciseOccurrence(workouts, reference, {
  beforeOrOn,
  exerciseLibrary: libraryFor(workouts, reference),
  gymLocation,
})

test('free weight previous result crosses gyms and keeps exact exercise identity', () => {
  const bench = exercise('bench-press', 90, 6)
  const rows = [
    workout('older', '2026-08-01', 'Gym A', bench),
    workout('latest', '2026-08-08', 'Gym B', exercise('bench-press', 90, 7)),
    workout('different', '2026-08-09', 'Gym B', exercise('incline-smith', 100, 8, true)),
  ]
  const result = previousExerciseOccurrence(rows, bench, '2026-08-10', 'Gym A')
  assert.equal(result.latest?.workout.id, 'latest')
  assert.equal(result.comparable?.workout.id, 'latest')
})

test('equipment-sensitive previous result is restricted to the same gym', () => {
  const machine = exercise('cable-fly', 30, 10, true)
  const rows = [
    workout('same-gym', '2026-08-01', 'Gym A', machine),
    workout('other-gym', '2026-08-08', 'Gym B', exercise('cable-fly', 40, 10, true)),
  ]
  const result = previousExerciseOccurrence(rows, machine, '2026-08-10', 'Gym A')
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
  const result = previousExerciseOccurrence(rows, reference, '2026-08-15', 'Gym A')
  assert.equal(result.latest?.workout.id, 'session-d')
  assert.equal(result.comparable?.workout.id, 'session-d')
})

test('same machine in another gym is latest but never directly comparable', () => {
  const reference = exercise('machine-row', 70, 8, true)
  const rows = [workout('other-gym', '2026-08-08', 'Gym B', exercise('machine-row', 75, 8, true))]
  const result = previousExerciseOccurrence(rows, reference, '2026-08-10', 'Gym A')
  assert.equal(result.latest?.workout.id, 'other-gym')
  assert.equal(result.comparable, undefined)
})

test('custom exercise remains selectable by its stable exerciseId', () => {
  const reference = exercise('custom-seal-row', 60, 8)
  const rows = [workout('custom-session', '2026-08-08', 'Gym A', exercise('custom-seal-row', 57.5, 9))]
  assert.equal(previousExerciseOccurrence(rows, reference, '2026-08-10', 'Gym A').comparable?.workout.id, 'custom-session')
})

test('cable row and machine row never share history', () => {
  const rows = [workout('machine-session', '2026-08-08', 'Gym A', exercise('machine-row', 100, 9, true))]
  assert.equal(previousExerciseOccurrence(rows, exercise('chest-supported-row', 80, 8, true), '2026-08-10', 'Gym A').latest, undefined)
})

test('machine lateral raise and dumbbell lateral raise never share history', () => {
  const rows = [workout('dumbbell-session', '2026-08-08', 'Gym A', exercise('dumbbell-lateral-raise', 12, 12))]
  assert.equal(previousExerciseOccurrence(rows, exercise('lateral-raise-machine', 30, 12, true), '2026-08-10', 'Gym A').latest, undefined)
})

test('same template slot replacement uses the selected existing identity without rewriting history', () => {
  const library: ExerciseDefinition[] = [
    { id: 'cable-row', name: 'Cable Row', equipmentSensitive: true },
    { id: 'hip-thrust-machine', name: 'Hip Thrust Machine', equipmentSensitive: true },
  ]
  const previous: TemplateExercise = {
    id: 'template-slot-3',
    exerciseId: 'cable-row',
    name: 'Cable Row',
    prescription: '3 × 6–10',
    defaultSets: 3,
    equipmentSensitive: true,
  }
  const edited = { ...previous, exerciseId: 'hip-thrust-machine', name: 'Hip Thrust Machine' }
  const libraryBefore = structuredClone(library)
  const resolvedId = resolveTemplateExerciseId(edited)
  assert.equal(edited.id, previous.id)
  assert.equal(resolvedId, 'hip-thrust-machine')
  assert.deepEqual(library, libraryBefore)

  const history = [
    workout('cable-history', '2026-08-01', 'Gym A', exercise('cable-row', 82, 9, true)),
    workout('hip-history', '2026-08-02', 'Gym A', exercise('hip-thrust-machine', 100, 10, true)),
  ]
  const before = structuredClone(history)
  const reference = exercise(resolvedId!, 0, 0, true)
  const comparable = selectPreviousExerciseOccurrence(history, reference, {
    beforeOrOn: '2026-09-06',
    exerciseLibrary: library,
    gymLocation: 'Gym A',
  })
  assert.equal(comparable.latest?.workout.id, 'hip-history')
  assert.equal(comparable.comparable?.workout.id, 'hip-history')
  assert.equal(previousExerciseOccurrence(history, exercise('cable-row', 0, 0, true), '2026-09-06', 'Gym A').latest?.workout.id, 'cable-history')
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

test('rename preserves exact identity and historical continuity', () => {
  const library: ExerciseDefinition[] = [{ id: 'stable-press', name: 'Nowa nazwa', equipmentSensitive: false }]
  const historical = workout('history', '2026-08-01', 'Gym A', {
    ...exercise('stable-press', 80, 8),
    name: 'Stara nazwa',
  })
  const renamedReference = { ...exercise('stable-press', 82.5, 8), name: 'Nowa nazwa' }
  const result = selectPreviousExerciseOccurrence([historical], renamedReference, {
    beforeOrOn: '2026-08-02',
    exerciseLibrary: library,
    gymLocation: 'Gym A',
  })
  assert.equal(result.latest?.workout.id, 'history')
  assert.equal(historical.exercises[0].name, 'Stara nazwa')
})

test('same display name never merges different exercise IDs', () => {
  const library: ExerciseDefinition[] = [
    { id: 'row-a', name: 'Row', equipmentSensitive: false },
    { id: 'row-b', name: 'Row', equipmentSensitive: false },
  ]
  const rows = [
    workout('row-a-history', '2026-08-01', 'Gym A', { ...exercise('row-a', 50, 10), name: 'Row' }),
    workout('row-b-history', '2026-08-02', 'Gym A', { ...exercise('row-b', 60, 10), name: 'Row' }),
  ]
  const result = selectPreviousExerciseOccurrence(rows, { ...exercise('row-a', 0, 0), name: 'Row' }, {
    beforeOrOn: '2026-08-03',
    exerciseLibrary: library,
  })
  assert.equal(result.latest?.workout.id, 'row-a-history')
})

test('alias collision never merges different exercise IDs', () => {
  const library: ExerciseDefinition[] = [
    { id: 'press-a', name: 'Press A', aliases: ['Shared press'], equipmentSensitive: false },
    { id: 'press-b', name: 'Press B', aliases: ['Shared press'], equipmentSensitive: false },
  ]
  const rows = [
    workout('press-a-history', '2026-08-01', 'Gym A', { ...exercise('press-a', 50, 10), name: 'Shared press' }),
    workout('press-b-history', '2026-08-02', 'Gym A', { ...exercise('press-b', 60, 10), name: 'Shared press' }),
  ]
  const result = selectPreviousExerciseOccurrence(rows, { ...exercise('press-a', 0, 0), name: 'Shared press' }, {
    beforeOrOn: '2026-08-03',
    exerciseLibrary: library,
  })
  assert.equal(result.latest?.workout.id, 'press-a-history')
})

test('unresolved identity is read-only data quality and excluded from longitudinal history', () => {
  const unresolvedExercise: WorkoutExercise = {
    id: 'known-definition',
    name: 'Legacy exercise',
    sets: [{ id: 'legacy-set', weight: 20, reps: 10 }],
  }
  const unknownExercise = { ...unresolvedExercise, id: 'unknown-slot', exerciseId: 'unknown-definition' }
  const invalidExercise = { ...unresolvedExercise, id: 'invalid-slot', exerciseId: ' known-definition ' }
  const data: Pick<AppData, 'exerciseLibrary' | 'templates' | 'workouts'> = {
    exerciseLibrary: [{ id: 'known-definition', name: 'Known exercise', equipmentSensitive: false }],
    templates: [],
    workouts: [
      workout('missing-history', '2026-08-01', 'Gym A', unresolvedExercise),
      workout('unknown-history', '2026-08-02', 'Gym A', unknownExercise),
      workout('invalid-history', '2026-08-03', 'Gym A', invalidExercise),
    ],
  }
  const before = structuredClone(data)
  const audit = auditExerciseIdentities(data)
  const missingHistory = selectPreviousExerciseOccurrence(data.workouts, unresolvedExercise, {
    beforeOrOn: '2026-08-03',
    exerciseLibrary: data.exerciseLibrary,
  })
  const unknownHistory = selectPreviousExerciseOccurrence(data.workouts, unknownExercise, {
    beforeOrOn: '2026-08-04',
    exerciseLibrary: data.exerciseLibrary,
  })
  const invalidHistory = selectPreviousExerciseOccurrence(data.workouts, invalidExercise, {
    beforeOrOn: '2026-08-04',
    exerciseLibrary: data.exerciseLibrary,
  })

  assert.equal(audit.unresolvedReferences, 3)
  assert.deepEqual(audit.issues.map((issue) => issue.reason), [
    'MISSING_EXERCISE_ID',
    'UNKNOWN_EXERCISE_DEFINITION',
    'INVALID_EXERCISE_ID',
  ])
  assert.equal(missingHistory.identityIssue, UNRESOLVED_EXERCISE_IDENTITY)
  assert.equal(unknownHistory.identityIssue, UNRESOLVED_EXERCISE_IDENTITY)
  assert.equal(invalidHistory.identityIssue, UNRESOLVED_EXERCISE_IDENTITY)
  assert.equal(missingHistory.latest, undefined)
  assert.equal(unknownHistory.latest, undefined)
  assert.equal(invalidHistory.latest, undefined)
  assert.deepEqual(data, before)
})
