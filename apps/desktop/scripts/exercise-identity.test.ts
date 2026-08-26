import type { TemplateExercise, TrainingTemplate, Workout, WorkoutExercise } from '../src/types'
import {
  fixtureSet as set,
  fixtureTemplateExercise as templateExercise,
  fixtureWorkout as workout,
  fixtureWorkoutExercise as workoutExercise,
  legacyTemplatesFixture,
  legacyV2Fixture,
  legacyWorkoutsFixture,
} from './fixtures/exercise-identity.fixture.ts'

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
const { exerciseOccurrencesByWorkout, exercisesMatch, previousExerciseOccurrence, replaceWorkoutById } = workoutData
const { equipmentComparisonIssue } = workoutProgress
const { normalizeData } = storage

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
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

const legacyTemplates = clone(legacyTemplatesFixture)
const legacyWorkouts = clone(legacyWorkoutsFixture)

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

const legacyV2 = normalizeData(clone(legacyV2Fixture))
assertDeepEqual(withoutExerciseIds(legacyV2.templates), legacyTemplates, 'import v2 nie może przywracać domyślnych szablonów')
assertDeepEqual(withoutExerciseIds(legacyV2.workouts), legacyWorkouts, 'import v2 nie może zmieniać zapisanych treningów')
assertEqual(legacyV2.dailyEntries.length, 1, 'import v2 nie może duplikować wpisu Dziennika')
assertEqual(legacyV2.dailyEntries[0].id, 'fixture-daily-entry-1', 'import v2 zachowuje ID wpisu Dziennika')
assertEqual(legacyV2.dailyEntries[0].date, '2026-01-01', 'import v2 zachowuje datę wpisu Dziennika')
assertEqual(legacyV2.dailyEntries[0].fat, 71, 'import v2 zachowuje tłuszcz')
assertEqual(legacyV2.coachNotes.fixture, 'Synthetic coach note', 'import v2 zachowuje notatki trenera')

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
const sharedPress = definition('Wyciskanie testowe')

assertEqual(cableRow.id, 'chest-supported-row', 'Wiosło na wyciągu ma stabilny canonical ID')
assertEqual(machineRow.id, 'machine-row', 'Wiosło na maszynie ma oddzielny canonical ID')
assert(cableRow.id !== machineRow.id, 'Wiosło na wyciągu i na maszynie nie mogą dzielić historii')
assertEqual(rearDelt.id, 'rear-delt-machine', 'duplikaty odwrotnych rozpiętek muszą zostać scalone')
assertEqual(dumbbellRaise.id, 'dumbbell-lateral-raise', 'własne unoszenie hantli musi trafić do biblioteki')
assert(dumbbellRaise.id !== cableRaise.id, 'hantle i wyciąg/maszyna muszą pozostać rozdzielone')
assertEqual(dumbbellRaise.equipmentSensitive, false, 'unoszenie hantli nie zależy od siłowni')
assertEqual(triceps.id, 'overhead-triceps-extension', 'identyczne ćwiczenie tricepsa musi mieć wspólną historię')
assertEqual(triceps.equipmentSensitive, false, 'ćwiczenie ze sztangą nie powinno zależeć od siłowni')

const migratedTemplateA = migrated.templates.find((item) => item.id === 'fixture-push')!
const migratedTemplateD = migrated.templates.find((item) => item.id === 'fixture-upper')!
const sharedPressA = migratedTemplateA.exercises.find((item) => item.id === 'a-shared-press')!
const sharedPressD = migratedTemplateD.exercises.find((item) => item.id === 'd-shared-press')!
const cableRowA = migratedTemplateA.exercises.find((item) => item.id === 'chest-supported-row')!
const cableRowD = migratedTemplateD.exercises.find((item) => item.id === 'machine-row')!
const rearA = migratedTemplateA.exercises.find((item) => item.id === 'rear-delt-machine')!
const rearD = migratedTemplateD.exercises.find((item) => item.id === 'reverse-fly')!
const cableRaiseTemplate = migratedTemplateD.exercises.find((item) => item.id === 'lateral-raise-cable')!

assertEqual(sharedPressA.exerciseId, sharedPressD.exerciseId, 'to samo ćwiczenie w A i D musi mieć jeden exerciseId')
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

const sharedPressPrevious = previousExerciseOccurrence(
  migrated.workouts,
  activeReference(sharedPressA),
  '2026-01-04',
  'Klub Północ',
)
assertEqual(sharedPressPrevious.latest?.workout.id, 'fixture-workout-d-2', 'A→D→A: najnowszy wynik ma pochodzić z D')
assertEqual(sharedPressPrevious.comparable?.workout.id, 'fixture-workout-d-2', 'wolny ciężar porównuje wynik między siłowniami')
assertEqual(sharedPressPrevious.comparable?.exercise.sets[0].reps, 12, 'A→D→A zwraca 10×12, nie starsze 10×10')

const cablePrevious = previousExerciseOccurrence(
  migrated.workouts,
  activeReference(cableRowA),
  '2026-01-04',
  'Klub Północ',
)
assertEqual(cablePrevious.latest?.workout.id, 'fixture-workout-d-2', 'latest pokazuje najnowsze wykonanie canonical exercise')
assertEqual(cablePrevious.comparable?.workout.id, 'fixture-workout-a-1', 'maszyna/wyciąg wybiera ostatni wynik z tej samej siłowni')
assertEqual(cablePrevious.comparable?.exercise.sets[0].weight, 80, 'powrót do Klubu Północ zwraca 80×8')
assert(!exercisesMatch(machineWorkoutExercise, activeReference(cableRowA)), '100×9 z Wiosła na maszynie nie może wejść do historii wyciągu')
assert(
  equipmentComparisonIssue(
    { ...activeReference(cableRowA), equipmentSensitive: false },
    { ...activeReference(cableRowA), equipmentSensitive: true },
    'Klub Północ',
    'Klub Południe',
  )?.incomparable,
  'jawne false jednego wystąpienia nie może wyłączyć ochrony true drugiego',
)

const duplicateCanonicalSession = workout('fixture-workout-duplicate-canonical', '2026-01-05', 'fixture-push', 'A', 'PUSH', 'Klub Północ', [
  workoutExercise('shared-copy-1', 'Wyciskanie testowe', [set('shared-copy-set-1', 20, 8)], false, { exerciseId: sharedPress.id }),
  workoutExercise('shared-copy-2', 'Wyciskanie testowe', [set('shared-copy-set-2', 22.5, 7)], false, { exerciseId: sharedPress.id }),
  workoutExercise('shared-skipped', 'Wyciskanie testowe', [set('shared-skipped-set', 100, 1)], false, { exerciseId: sharedPress.id, skipped: true }),
  workoutExercise('shared-empty', 'Wyciskanie testowe', [], false, { exerciseId: sharedPress.id }),
  workoutExercise('shared-other-identity', 'Wyciskanie testowe', [set('shared-other-set', 999, 1)], false, { exerciseId: 'different-shared-press' }),
])
const duplicateSessionSnapshot = JSON.stringify(duplicateCanonicalSession)
const groupedSharedOccurrences = exerciseOccurrencesByWorkout(
  [...migrated.workouts, duplicateCanonicalSession].sort((a, b) => b.date.localeCompare(a.date)),
  (exercise) => canonicalExerciseId(exercise) === sharedPress.id,
)
assertEqual(groupedSharedOccurrences.length, 3, 'dwa refy canonical w jednej sesji liczą się jako jedna occurrence')
assertEqual(groupedSharedOccurrences[0].workout.id, duplicateCanonicalSession.id, 'agregat zachowuje najnowszą sesję jako current')
assertEqual(groupedSharedOccurrences[1].workout.id, 'fixture-workout-d-2', 'previous po agregacji pochodzi z wcześniejszej sesji')
assertDeepEqual(
  groupedSharedOccurrences[0].exercise.sets.map((item) => item.id),
  ['shared-copy-set-1', 'shared-copy-set-2'],
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

const customDefinition = definition('Unoszenie bokiem z hantlami')
const progressReferenceIds = new Set([
  ...migrated.templates.flatMap((template) => template.exercises.map(canonicalExerciseId)),
  ...migrated.workouts.flatMap((item) => item.exercises.map(canonicalExerciseId)),
])
const progressLibrary = migrated.exerciseLibrary.filter((item) => progressReferenceIds.has(item.id))
assert(
  progressLibrary.some((item) => item.id === customDefinition.id),
  'custom exercise musi być widoczne w bibliotece ćwiczeń referencjonowanych przez Progres',
)
const customProgressOccurrences = exerciseOccurrencesByWorkout(
  migrated.workouts,
  (exercise) => canonicalExerciseId(exercise) === customDefinition.id,
)
assertEqual(customProgressOccurrences.length, 1, 'custom exercise musi pozostać dostępne dla danych Progresu')
assertEqual(
  customProgressOccurrences[0].exercise.exerciseId,
  customDefinition.id,
  'custom exercise w historii musi wskazywać definicję widoczną w bibliotece Progresu',
)

const workoutsBeforeEdit = clone(migrated.workouts)
const editedWorkout = {
  ...clone(migrated.workouts[1]),
  duration: 81,
  note: 'Synthetic edited workout',
}
const workoutsAfterEdit = replaceWorkoutById(migrated.workouts, editedWorkout)
assertEqual(workoutsAfterEdit.length, migrated.workouts.length, 'edycja treningu nie może zmienić liczby treningów')
assertEqual(
  workoutsAfterEdit.filter((item) => item.id === editedWorkout.id).length,
  1,
  'edycja historycznego treningu nie może utworzyć duplikatu ID',
)
assertDeepEqual(
  workoutsAfterEdit.map((item) => item.id),
  migrated.workouts.map((item) => item.id),
  'edycja treningu musi zachować kolejność i identyfikatory sesji',
)
assertEqual(workoutsAfterEdit[1].duration, 81, 'edycja treningu musi zastąpić wskazany rekord')
assertDeepEqual(migrated.workouts, workoutsBeforeEdit, 'edycja treningu nie może mutować wejściowej tablicy')

console.log('PASS deterministic regressions: identity, migration, history, gym comparison, custom exercise and workout edit')
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
