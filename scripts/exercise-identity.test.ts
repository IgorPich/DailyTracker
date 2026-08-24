import type { ExerciseDefinition, TemplateExercise, TrainingTemplate, Workout, WorkoutExercise, WorkoutSet } from '../src/types'

const runAssertions = async () => {
const [exerciseIdentity, dataMigration, workoutData, workoutProgress, storage] = await Promise.all([
  import('../src/utils/exerciseIdentity'),
  import('../src/utils/dataMigration'),
  import('../src/utils/workoutData'),
  import('../src/utils/workoutProgress'),
  import('../src/utils/storage'),
])
const {
  canonicalExerciseId,
  findExerciseDefinitionByName,
  normalizeExerciseName,
  withRegisteredExercise,
} = exerciseIdentity
const { migrateExerciseIdentity } = dataMigration
const { exerciseOccurrencesByWorkout, exercisesMatch, previousExerciseOccurrence } = workoutData
const { equipmentComparisonIssue } = workoutProgress
const { normalizeData } = storage

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

const assertEqual = (actual: unknown, expected: unknown, message: string) => {
  assert(Object.is(actual, expected), `${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`)
}

const assertDeepEqual = (actual: unknown, expected: unknown, message: string) => {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  assert(actualJson === expectedJson, `${message}\nExpected: ${expectedJson}\nActual: ${actualJson}`)
}

const clone = <T,>(value: T): T => structuredClone(value)

const set = (id: string, weight: number, reps: number, rir?: number): WorkoutSet => ({
  id,
  weight,
  reps,
  ...(rir === undefined ? {} : { rir }),
})

const templateExercise = (
  id: string,
  name: string,
  equipmentSensitive = false,
  prescription = '1 × 6–12',
): TemplateExercise => ({
  id,
  name,
  prescription,
  defaultSets: 1,
  ...(equipmentSensitive ? { equipmentSensitive: true } : { equipmentSensitive: false }),
})

const workoutExercise = (
  id: string,
  name: string,
  sets: WorkoutSet[],
  equipmentSensitive = false,
  extras: Partial<WorkoutExercise> = {},
): WorkoutExercise => ({
  id,
  name,
  prescription: '1 × 6–12',
  sets,
  equipmentSensitive,
  ...extras,
})

const workout = (
  id: string,
  date: string,
  templateId: string,
  templateCode: Workout['templateCode'],
  templateName: string,
  gymLocation: string,
  exercises: WorkoutExercise[],
): Workout => ({
  id,
  date,
  templateId,
  templateCode,
  templateName,
  gymLocation,
  duration: 73,
  note: `Notatka ${id}`,
  exercises,
})

const legacyTemplates: TrainingTemplate[] = [
  {
    id: 'push',
    code: 'A',
    name: 'PUSH',
    exercises: [
      templateExercise('a-xyz', '  XYZ  '),
      templateExercise('chest-supported-row', 'Wiosło na wyciągu', true),
      templateExercise('rear-delt-machine', 'Odwrotne rozpiętki na maszynie', true),
      templateExercise('overhead-triceps-extension', 'Prostowanie ramion nad głową z sztangą na leżąco'),
    ],
  },
  {
    id: 'greek-upper',
    code: 'D',
    name: 'GRECKA GÓRA',
    exercises: [
      templateExercise('d-xyz', 'xYz'),
      templateExercise('machine-row', 'Wiosło   na wyciągu', true),
      templateExercise('reverse-fly', 'Odwrotne rozpiętki na maszynie', true),
      templateExercise('lateral-raise-cable', 'Unoszenie bokiem na wyciągu / maszynie', true),
      templateExercise('overhead-triceps-extension-d', 'Prostowanie ramion nad głową z sztangą na leżąco', true),
    ],
  },
]

const legacyWorkouts: Workout[] = [
  workout('workout-a-1', '2026-01-01', 'push', 'A', 'PUSH', 'Siłownia Alfa', [
    workoutExercise('a-xyz', 'XYZ', [set('a-xyz-set-1', 10, 10, 2)], false, { note: 'Pierwsze XYZ' }),
    workoutExercise('custom-cable-row', 'Wiosło na wyciągu', [set('a-row-set-1', 80, 8)], true, { isCustom: true }),
    workoutExercise('overhead-triceps-extension', 'Prostowanie ramion nad głową z sztangą na leżąco', [set('a-triceps-set-1', 25, 15)]),
  ]),
  workout('workout-d-2', '2026-01-02', 'greek-upper', 'D', 'GRECKA GÓRA', 'Siłownia Beta', [
    workoutExercise('d-xyz', ' xyz ', [set('d-xyz-set-1', 10, 12)], false, { note: 'Najnowsze XYZ' }),
    workoutExercise('machine-row', 'Wiosło na wyciągu', [set('d-row-set-1', 60, 10)], true),
    workoutExercise('reverse-fly', 'Odwrotne rozpiętki na maszynie', [set('d-rear-set-1', 49.5, 14)], true),
    workoutExercise('overhead-triceps-extension-d', 'Prostowanie ramion nad głową z sztangą na leżąco', [set('d-triceps-set-1', 35, 6)]),
  ]),
  workout('workout-d-3', '2026-01-03', 'greek-upper', 'D', 'GRECKA GÓRA', 'Siłownia Alfa', [
    workoutExercise('machine-row', 'Wiosło na maszynie', [set('machine-row-set-1', 100, 9)], true),
    workoutExercise('lateral-raise-cable', 'Unoszenie bokiem z hantalmi', [
      set('dumbbell-set-1', 12.5, 14),
      set('dumbbell-set-2', 14, 12),
    ], false, { note: 'Snapshot z literówką' }),
  ]),
]

const templatesBefore = clone(legacyTemplates)
const workoutsBefore = clone(legacyWorkouts)
const sourceSnapshot = JSON.stringify({ templates: legacyTemplates, workouts: legacyWorkouts })

const migrated = migrateExerciseIdentity(legacyTemplates, legacyWorkouts)

assertEqual(
  JSON.stringify({ templates: legacyTemplates, workouts: legacyWorkouts }),
  sourceSnapshot,
  'migracja nie może mutować danych wejściowych',
)
assertEqual(migrated.templates.length, templatesBefore.length, 'liczba szablonów musi zostać zachowana')
assertEqual(migrated.workouts.length, workoutsBefore.length, 'liczba treningów musi zostać zachowana')

const withoutExerciseIds = <T extends TrainingTemplate[] | Workout[]>(items: T): T => items.map((item) => ({
  ...item,
  exercises: item.exercises.map((exercise) => {
    const { exerciseId: _exerciseId, ...snapshot } = exercise
    return snapshot
  }),
})) as T

assertDeepEqual(
  withoutExerciseIds(migrated.templates),
  templatesBefore,
  'migracja może jedynie dodać exerciseId do szablonów',
)
assertDeepEqual(
  withoutExerciseIds(migrated.workouts),
  workoutsBefore,
  'migracja musi zachować workout/set IDs, daty, siłownie, serie, notatki i snapshoty nazw',
)

const migratedAgain = migrateExerciseIdentity(migrated.templates, migrated.workouts, migrated.exerciseLibrary)
assertDeepEqual(migratedAgain, migrated, 'migracja musi być idempotentna')

assertEqual(normalizeExerciseName('  WIOSŁO   na WYCIĄGU  '), 'wiosło na wyciągu', 'normalizacja trim/case/spaces')
assert(
  normalizeExerciseName('Wiosło na wyciągu') !== normalizeExerciseName('Wiosło na maszynie'),
  'normalizacja nie może wykonywać fuzzy merge',
)

const semanticReplacement = migrateExerciseIdentity(
  [{ id: 'replacement-test', code: 'A', name: 'A', exercises: [templateExercise('shared-legacy-id', 'Ćwiczenie A')] }],
  [workout('replacement-history', '2026-01-01', 'replacement-test', 'A', 'A', 'Siłownia Alfa', [
    workoutExercise('shared-legacy-id', 'Ćwiczenie B', [set('replacement-set', 10, 10)]),
  ])],
)
assert(
  semanticReplacement.templates[0].exercises[0].exerciseId !== semanticReplacement.workouts[0].exercises[0].exerciseId,
  'różne nazwy pod tym samym legacy ID muszą pozostać rozdzielone',
)

const legacyV2 = normalizeData({
  version: 2,
  dailyEntries: [{ id: 'entry-v2', date: '2026-01-01', fat: 71, note: 'zachowaj' }],
  workouts: legacyWorkouts,
  templates: legacyTemplates,
  settings: {
    phase: 'Maintenance',
    calorieTarget: 2800,
    proteinTarget: 160,
    trendThresholds: { lossBelow: -0.15, stableUpper: 0.05, slowGainUpper: 0.2 },
  },
  coachNotes: { old: 'zachowaj' },
})
assertDeepEqual(withoutExerciseIds(legacyV2.templates), legacyTemplates, 'import v2 nie może przywracać domyślnych szablonów')
assertDeepEqual(withoutExerciseIds(legacyV2.workouts), legacyWorkouts, 'import v2 nie może zmieniać zapisanych treningów')
assertEqual(legacyV2.dailyEntries[0].fat, 71, 'import v2 zachowuje tłuszcz')
assertEqual(legacyV2.coachNotes.old, 'zachowaj', 'import v2 zachowuje notatki trenera')

const definition = (name: string) => {
  const found = findExerciseDefinitionByName(migrated.exerciseLibrary, name)
  assert(found, `brak definicji: ${name}`)
  return found
}

const cableRow = definition('  WIOSŁO   NA WYCIĄGU ')
const machineRow = definition('Wiosło na maszynie')
const rearDelt = definition('Odwrotne rozpiętki na maszynie')
const dumbbellRaise = definition('Unoszenie bokiem z hantlami')
const cableRaise = definition('Unoszenie bokiem na wyciągu / maszynie')
const triceps = definition('Prostowanie ramion nad głową z sztangą na leżąco')
const xyz = definition('xyz')

assertEqual(cableRow.id, 'chest-supported-row', 'Wiosło na wyciągu ma stabilny canonical ID')
assertEqual(machineRow.id, 'machine-row', 'Wiosło na maszynie ma oddzielny canonical ID')
assert(cableRow.id !== machineRow.id, 'Wiosło na wyciągu i na maszynie nie mogą dzielić historii')
assertEqual(rearDelt.id, 'rear-delt-machine', 'duplikaty odwrotnych rozpiętek muszą zostać scalone')
assertEqual(dumbbellRaise.id, 'dumbbell-lateral-raise', 'własne unoszenie hantli musi trafić do biblioteki')
assert(dumbbellRaise.id !== cableRaise.id, 'hantle i wyciąg/maszyna muszą pozostać rozdzielone')
assertEqual(dumbbellRaise.equipmentSensitive, false, 'unoszenie hantli nie zależy od siłowni')
assertEqual(triceps.id, 'overhead-triceps-extension', 'identyczne ćwiczenie tricepsa musi mieć wspólną historię')
assertEqual(triceps.equipmentSensitive, false, 'ćwiczenie ze sztangą nie powinno zależeć od siłowni')

const migratedTemplateA = migrated.templates.find((item) => item.id === 'push')!
const migratedTemplateD = migrated.templates.find((item) => item.id === 'greek-upper')!
const xyzA = migratedTemplateA.exercises.find((item) => item.id === 'a-xyz')!
const xyzD = migratedTemplateD.exercises.find((item) => item.id === 'd-xyz')!
const cableRowA = migratedTemplateA.exercises.find((item) => item.id === 'chest-supported-row')!
const cableRowD = migratedTemplateD.exercises.find((item) => item.id === 'machine-row')!
const rearA = migratedTemplateA.exercises.find((item) => item.id === 'rear-delt-machine')!
const rearD = migratedTemplateD.exercises.find((item) => item.id === 'reverse-fly')!
const cableRaiseTemplate = migratedTemplateD.exercises.find((item) => item.id === 'lateral-raise-cable')!

assertEqual(xyzA.exerciseId, xyzD.exerciseId, 'XYZ w A i D musi mieć jeden exerciseId')
assertEqual(cableRowA.exerciseId, cableRowD.exerciseId, 'Wiosło na wyciągu w różnych template musi mieć jeden exerciseId')
assertEqual(rearA.exerciseId, rearD.exerciseId, 'Odwrotne rozpiętki w różnych template muszą mieć jeden exerciseId')

const machineWorkoutExercise = migrated.workouts[2].exercises.find((item) => item.name === 'Wiosło na maszynie')!
const dumbbellWorkoutExercise = migrated.workouts[2].exercises.find((item) => item.name === 'Unoszenie bokiem z hantalmi')!
assertEqual(machineWorkoutExercise.exerciseId, machineRow.id, 'historyczne Wiosło na maszynie zachowuje osobną tożsamość')
assertEqual(cableRaiseTemplate.exerciseId, cableRaise.id, 'template wyciągu/maszyny zachowuje swoją tożsamość')
assertEqual(dumbbellWorkoutExercise.exerciseId, dumbbellRaise.id, 'snapshot z literówką wskazuje właściwą definicję hantli')
assertEqual(dumbbellWorkoutExercise.name, 'Unoszenie bokiem z hantalmi', 'migracja nie poprawia historycznego snapshotu')

const activeReference = (exercise: TemplateExercise): WorkoutExercise => ({
  id: `active-${exercise.id}`,
  exerciseId: exercise.exerciseId,
  name: exercise.name,
  prescription: exercise.prescription,
  equipmentSensitive: exercise.equipmentSensitive,
  sets: [],
})

const xyzPrevious = previousExerciseOccurrence(
  migrated.workouts,
  activeReference(xyzA),
  '2026-01-04',
  'Siłownia Alfa',
)
assertEqual(xyzPrevious.latest?.workout.id, 'workout-d-2', 'A→D→A: najnowszy wynik ma pochodzić z D')
assertEqual(xyzPrevious.comparable?.workout.id, 'workout-d-2', 'wolny ciężar porównuje wynik między siłowniami')
assertEqual(xyzPrevious.comparable?.exercise.sets[0].reps, 12, 'A→D→A zwraca 10×12, nie starsze 10×10')

const cablePrevious = previousExerciseOccurrence(
  migrated.workouts,
  activeReference(cableRowA),
  '2026-01-04',
  'Siłownia Alfa',
)
assertEqual(cablePrevious.latest?.workout.id, 'workout-d-2', 'latest pokazuje najnowsze wykonanie canonical exercise')
assertEqual(cablePrevious.comparable?.workout.id, 'workout-a-1', 'maszyna/wyciąg wybiera ostatni wynik z tej samej siłowni')
assertEqual(cablePrevious.comparable?.exercise.sets[0].weight, 80, 'powrót na siłownię Alfa zwraca 80×8')
assert(!exercisesMatch(machineWorkoutExercise, activeReference(cableRowA)), '100×9 z Wiosła na maszynie nie może wejść do historii wyciągu')
assert(
  equipmentComparisonIssue(
    { ...activeReference(cableRowA), equipmentSensitive: false },
    { ...activeReference(cableRowA), equipmentSensitive: true },
    'Siłownia Alfa',
    'Siłownia Beta',
  )?.incomparable,
  'jawne false jednego wystąpienia nie może wyłączyć ochrony true drugiego',
)

const duplicateCanonicalSession = workout('workout-duplicate-canonical', '2026-01-05', 'push', 'A', 'PUSH', 'Siłownia Alfa', [
  workoutExercise('xyz-copy-1', 'XYZ', [set('xyz-copy-set-1', 20, 8)], false, { exerciseId: xyz.id }),
  workoutExercise('xyz-copy-2', 'XYZ', [set('xyz-copy-set-2', 22.5, 7)], false, { exerciseId: xyz.id }),
  workoutExercise('xyz-skipped', 'XYZ', [set('xyz-skipped-set', 100, 1)], false, { exerciseId: xyz.id, skipped: true }),
  workoutExercise('xyz-empty', 'XYZ', [], false, { exerciseId: xyz.id }),
  workoutExercise('xyz-other-identity', 'XYZ', [set('xyz-other-set', 999, 1)], false, { exerciseId: 'different-xyz' }),
])
const duplicateSessionSnapshot = JSON.stringify(duplicateCanonicalSession)
const groupedXyzOccurrences = exerciseOccurrencesByWorkout(
  [...migrated.workouts, duplicateCanonicalSession].sort((a, b) => b.date.localeCompare(a.date)),
  (exercise) => canonicalExerciseId(exercise) === xyz.id,
)
assertEqual(groupedXyzOccurrences.length, 3, 'dwa refy canonical w jednej sesji liczą się jako jedna occurrence')
assertEqual(groupedXyzOccurrences[0].workout.id, duplicateCanonicalSession.id, 'agregat zachowuje najnowszą sesję jako current')
assertEqual(groupedXyzOccurrences[1].workout.id, 'workout-d-2', 'previous po agregacji pochodzi z wcześniejszej sesji')
assertDeepEqual(
  groupedXyzOccurrences[0].exercise.sets.map((item) => item.id),
  ['xyz-copy-set-1', 'xyz-copy-set-2'],
  'agregat zachowuje wszystkie widoczne serie i ich kolejność, pomijając skipped/puste refy',
)
assertEqual(JSON.stringify(duplicateCanonicalSession), duplicateSessionSnapshot, 'agregacja nie może mutować treningu wejściowego')

const cableSessions = migrated.workouts.filter((item) => item.exercises.some((exercise) => (
  canonicalExerciseId(exercise) === cableRow.id && exercise.sets.length > 0 && !exercise.skipped
))).length
assertEqual(cableSessions, 2, 'liczba treningów canonical exercise liczy sesje A i D')

const normalizedLibraryNames = migrated.exerciseLibrary.map((item) => normalizeExerciseName(item.name))
assertEqual(
  new Set(normalizedLibraryNames).size,
  normalizedLibraryNames.length,
  'biblioteka nie może zawierać powtórzonych nazw canonical',
)

const reused = withRegisteredExercise(
  migrated.exerciseLibrary,
  '  wiosło   NA wyciągu ',
  true,
  'nie-tworz-tego-id',
)
assertEqual(reused.definition.id, cableRow.id, 'dodanie exact-name musi użyć istniejącej definicji')
assert(reused.library === migrated.exerciseLibrary, 'reuse exact-name nie powinien przebudowywać biblioteki')

const newExercise = withRegisteredExercise(
  migrated.exerciseLibrary,
  'Wiosło na wyciągu jednorącz',
  true,
  'single-arm-cable-row',
)
assertEqual(newExercise.definition.id, 'single-arm-cable-row', 'rzeczywiście nowe ćwiczenie dostaje nowy ID')
assertEqual(newExercise.library.length, migrated.exerciseLibrary.length + 1, 'nowa definicja trafia do globalnej biblioteki')

const auditLiveStore = async () => {
  const [{ existsSync, readFileSync }, { join }, { createHash }] = await Promise.all([
    import('node:fs'),
    import('node:path'),
    import('node:crypto'),
  ])
  const appDataDirectory = process.env.APPDATA
  if (!appDataDirectory) {
    console.log('SKIP live Store: brak zmiennej APPDATA')
    return
  }
  const storePath = join(appDataDirectory, 'com.igorpich.formlog', 'formlog.store.json')
  if (!existsSync(storePath)) {
    console.log(`SKIP live Store: plik nie istnieje (${storePath})`)
    return
  }

  const rawBefore = readFileSync(storePath, 'utf8')
  const parsed = JSON.parse(rawBefore) as { appData?: Record<string, unknown> }
  const liveData = parsed.appData
  assert(liveData, 'live Store nie zawiera appData')
  assert(Array.isArray(liveData.templates), 'live Store nie zawiera templates')
  assert(Array.isArray(liveData.workouts), 'live Store nie zawiera workouts')
  const liveTemplates = liveData.templates as TrainingTemplate[]
  const liveWorkouts = liveData.workouts as Workout[]
  const liveLibrary = Array.isArray(liveData.exerciseLibrary)
    ? liveData.exerciseLibrary as ExerciseDefinition[]
    : []
  const liveSnapshot = clone(liveData)
  const liveInputJson = JSON.stringify({ templates: liveTemplates, workouts: liveWorkouts, exerciseLibrary: liveLibrary })

  const liveMigrated = migrateExerciseIdentity(liveTemplates, liveWorkouts, liveLibrary)
  assertEqual(
    JSON.stringify({ templates: liveTemplates, workouts: liveWorkouts, exerciseLibrary: liveLibrary }),
    liveInputJson,
    'audyt live Store: migracja nie może mutować obiektu wejściowego',
  )
  assertDeepEqual(
    withoutExerciseIds(liveMigrated.templates),
    withoutExerciseIds(liveSnapshot.templates as TrainingTemplate[]),
    'audyt live Store: wszystkie istniejące pola szablonów muszą zostać zachowane',
  )
  assertDeepEqual(
    withoutExerciseIds(liveMigrated.workouts),
    withoutExerciseIds(liveSnapshot.workouts as Workout[]),
    'audyt live Store: wszystkie workout/set IDs, serie, daty, siłownie, notatki i snapshoty muszą zostać zachowane',
  )
  if (Number(liveData.version) >= 4) {
    assertDeepEqual(liveMigrated.templates, liveSnapshot.templates, 'audyt live Store v4: szablony są idempotentne')
    assertDeepEqual(liveMigrated.workouts, liveSnapshot.workouts, 'audyt live Store v4: treningi są idempotentne')
  }
  const liveMigratedAgain = migrateExerciseIdentity(
    liveMigrated.templates,
    liveMigrated.workouts,
    liveMigrated.exerciseLibrary,
  )
  assertDeepEqual(liveMigratedAgain, liveMigrated, 'audyt live Store: migracja musi być idempotentna')
  const liveLibraryNames = liveMigrated.exerciseLibrary.map((item) => normalizeExerciseName(item.name))
  assertEqual(
    new Set(liveLibraryNames).size,
    liveLibraryNames.length,
    'audyt live Store: dropdown nie może dostać identycznych nazw z kilku definicji',
  )

  const requiredWorkout = (id: string) => {
    const found = liveMigrated.workouts.find((item) => item.id === id)
    assert(found, `audyt live Store: brak workout ${id}`)
    return found
  }
  const requiredExercise = (sourceWorkout: Workout, id: string, name: string) => {
    const found = sourceWorkout.exercises.find((item) => item.id === id && item.name === name)
    assert(found, `audyt live Store: brak ${id} / ${name} w ${sourceWorkout.id}`)
    return found
  }
  const setValues = (exercise: WorkoutExercise) => exercise.sets.map((item) => [item.weight, item.reps])

  const pullWorkout = requiredWorkout('4ddd80c2-80f0-4d63-9ca6-a19d3ae71d82')
  assertEqual(pullWorkout.gymLocation, 'Warszawianka', 'audyt live Store: siłownia PULL 18.08')
  const cableRowLive = requiredExercise(
    pullWorkout,
    'custom-7f5e8423-911a-4de0-8388-ef2e31f06d9f',
    'Wiosło na wyciągu',
  )
  assertEqual(cableRowLive.exerciseId, 'chest-supported-row', 'audyt live Store: canonical Wiosła na wyciągu')
  assertDeepEqual(setValues(cableRowLive), [[80, 7], [80, 8], [80, 7]], 'audyt live Store: serie Wiosła na wyciągu')

  const greekWorkout = requiredWorkout('2072188f-d3f5-4edf-949e-0d79b4b13b5f')
  assertEqual(greekWorkout.gymLocation, 'Warszawianka', 'audyt live Store: siłownia GRECKA GÓRA 22.08')
  const machineRowLive = requiredExercise(greekWorkout, 'machine-row', 'Wiosło na maszynie')
  assertEqual(machineRowLive.exerciseId, 'machine-row', 'audyt live Store: canonical Wiosła na maszynie')
  assertDeepEqual(setValues(machineRowLive), [[76.5, 14], [91, 13], [100, 9]], 'audyt live Store: serie Wiosła na maszynie')
  assert(
    cableRowLive.exerciseId !== machineRowLive.exerciseId,
    'audyt live Store: Wiosło na wyciągu i na maszynie muszą pozostać rozdzielone',
  )

  const dumbbellLive = requiredExercise(greekWorkout, 'lateral-raise-cable', 'Unoszenie bokiem z hantalmi')
  assertEqual(dumbbellLive.exerciseId, 'dumbbell-lateral-raise', 'audyt live Store: canonical własnego ćwiczenia z hantlami')
  assertEqual(dumbbellLive.equipmentSensitive, false, 'audyt live Store: hantle nie zależą od siłowni')
  assertDeepEqual(
    setValues(dumbbellLive),
    [[12.5, 14], [14, 12], [14, 12], [12, 17]],
    'audyt live Store: serie unoszenia bokiem z hantlami',
  )

  const reverseFlyLive = requiredExercise(greekWorkout, 'reverse-fly', 'Odwrotne rozpiętki na maszynie')
  assertEqual(reverseFlyLive.exerciseId, 'rear-delt-machine', 'audyt live Store: canonical odwrotnych rozpiętek')
  assertDeepEqual(setValues(reverseFlyLive), [[49.5, 14], [49.5, 15]], 'audyt live Store: serie odwrotnych rozpiętek')
  const rearDeltLive = requiredExercise(pullWorkout, 'rear-delt-machine', 'Rear Delt Machine')
  assertEqual(rearDeltLive.exerciseId, reverseFlyLive.exerciseId, 'audyt live Store: oba legacy ID odwrotnych rozpiętek łączą historię')
  assertDeepEqual(setValues(rearDeltLive), [[50, 12], [45, 11], [40, 9]], 'audyt live Store: starsze serie Rear Delt Machine')

  const rawAfter = readFileSync(storePath, 'utf8')
  assertEqual(rawAfter, rawBefore, 'audyt live Store musi pozostawić plik identyczny bajt w bajt')
  const hash = createHash('sha256').update(rawAfter).digest('hex').toUpperCase()
  console.log(`PASS live Store v${String(liveData.version)} read-only: ${liveWorkouts.length} workouts, SHA256 ${hash}`)
}

await auditLiveStore()

console.log('PASS exercise identity: migration, preservation, A→D→A and gym comparability')
}

if (process.env.GREEKGOD_IDENTITY_TEST_VITE === '1') {
  await runAssertions()
} else {
  process.env.GREEKGOD_IDENTITY_TEST_VITE = '1'
  const { createServer } = await import('vite')
  const server = await createServer({
    root: process.cwd(),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })
  try {
    await server.ssrLoadModule('/scripts/exercise-identity.test.ts')
  } finally {
    await server.close()
  }
}
