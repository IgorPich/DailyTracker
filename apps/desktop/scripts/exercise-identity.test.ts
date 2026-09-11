import type { ExerciseDefinition, TemplateExercise, TrainingTemplate, Workout, WorkoutExercise } from '../src/types'
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
const [core, exerciseIdentity, dataMigration, workoutData, workoutProgress, storage, templateIdentity, reportExerciseCandidates] = await Promise.all([
  import('@greekgod/core'),
  import('../src/utils/exerciseIdentity'),
  import('../src/utils/dataMigration'),
  import('../src/utils/workoutData'),
  import('../src/utils/workoutProgress'),
  import('../src/utils/storage'),
  import('../src/utils/templateIdentity'),
  import('../src/utils/reportExerciseCandidates'),
])
const {
  canonicalExerciseId,
  normalizeExerciseName,
  registerExerciseDefinition,
} = exerciseIdentity
const { migrateLegacyExerciseIdentity } = dataMigration
const { exerciseOccurrencesByWorkout, exercisesMatch, previousExerciseOccurrence, replaceWorkoutById } = workoutData
const { equipmentComparisonIssue } = workoutProgress
const { createInitialData, normalizeData } = storage
const { updateTemplateAndLibrary } = templateIdentity
const { activeReportExerciseDefinitions } = reportExerciseCandidates

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

const initialDesktopData = createInitialData()
const initialDesktopRelationships = [
  ['machine-row', 'chest-supported-row'],
  ['reverse-fly', 'rear-delt-machine'],
  ['overhead-triceps-extension-d', 'overhead-triceps-extension'],
] as const
for (const [slotId, exerciseId] of initialDesktopRelationships) {
  const references = initialDesktopData.templates
    .flatMap((template) => template.exercises)
    .filter((exercise) => exercise.id === slotId)
  assertEqual(references.length, 1, `Desktop seed zawiera dokładnie jeden slot ${slotId}`)
  assertEqual(references[0].exerciseId, exerciseId, `Desktop seed jawnie zachowuje canonical ID dla ${slotId}`)
}
assertEqual(initialDesktopData.exerciseLibrary.length, 28, 'Desktop seed zachowuje 28 canonical ExerciseDefinitions z v3')
assertEqual(
  new Set(initialDesktopData.templates.flatMap((template) => template.exercises.map((exercise) => exercise.exerciseId))).size,
  28,
  'Desktop seed nie tworzy duplikatów ExerciseDefinitions dla współdzielonych ćwiczeń',
)

const sharedDefinition: ExerciseDefinition = {
  id: 'synthetic-definition-a',
  name: 'Synthetic definition A',
  equipmentSensitive: false,
}
const replacementDefinition: ExerciseDefinition = {
  id: 'synthetic-definition-b',
  name: 'Synthetic definition B',
  equipmentSensitive: true,
}
const sharedTemplateExercise = (slotId: string): TemplateExercise => ({
  id: slotId,
  exerciseId: sharedDefinition.id,
  name: sharedDefinition.name,
  prescription: '3 × 8–12',
  defaultSets: 3,
})
const templateB: TrainingTemplate = {
  id: 'synthetic-template-b',
  code: 'B',
  name: 'Synthetic template B',
  exercises: [sharedTemplateExercise('synthetic-slot-b')],
}
const templateD: TrainingTemplate = {
  id: 'synthetic-template-d',
  code: 'D',
  name: 'Synthetic template D',
  exercises: [sharedTemplateExercise('synthetic-slot-d')],
}
const identityUpdateData = {
  ...clone(initialDesktopData),
  exerciseLibrary: [sharedDefinition, replacementDefinition],
  templates: [templateB, templateD],
  workouts: [workout('synthetic-history', '2026-01-01', templateB.id, 'B', templateB.name, 'Synthetic gym', [
    workoutExercise('synthetic-slot-b', sharedDefinition.name, [set('synthetic-set', 10, 10)], false, { exerciseId: sharedDefinition.id }),
  ])],
}
const identityUpdateSnapshot = clone(identityUpdateData)
const replacedTemplateD = {
  ...templateD,
  exercises: core.replaceTemplateExerciseDefinition(
    templateD.exercises,
    'synthetic-slot-d',
    replacementDefinition,
  ),
}
const replacedIdentity = updateTemplateAndLibrary(identityUpdateData, replacedTemplateD)
assertEqual(replacedIdentity.templates[0].exercises[0].exerciseId, sharedDefinition.id, 'replacement D nie może zmienić referencji B')
assertEqual(replacedIdentity.templates[1].exercises[0].id, 'synthetic-slot-d', 'replacement zachowuje TemplateExerciseId')
assertEqual(replacedIdentity.templates[1].exercises[0].exerciseId, replacementDefinition.id, 'replacement D wskazuje dokładny wybrany ExerciseDefinitionId')
assertDeepEqual(replacedIdentity.library, [sharedDefinition, replacementDefinition], 'replacement nie mutuje żadnej definicji')
assertDeepEqual(identityUpdateData, identityUpdateSnapshot, 'replacement nie mutuje templates, biblioteki ani historii wejściowej')

const attemptedHiddenRename = updateTemplateAndLibrary(identityUpdateData, {
  ...templateD,
  exercises: templateD.exercises.map((exercise) => ({ ...exercise, name: 'Unsafe implicit rename' })),
})
assertEqual(attemptedHiddenRename.templates[0].exercises[0].name, sharedDefinition.name, 'zmiana label D nie może zmienić B')
assertEqual(attemptedHiddenRename.templates[1].exercises[0].name, sharedDefinition.name, 'template slot pobiera nazwę z definicji')
assertEqual(attemptedHiddenRename.library[0].name, sharedDefinition.name, 'template edit nie może globalnie przemianować definicji')

const arbitraryDefinition: ExerciseDefinition = {
  id: 'synthetic-arbitrary-definition',
  name: 'Current arbitrary definition label',
  equipmentSensitive: false,
}
const inactiveDefinition: ExerciseDefinition = {
  id: 'synthetic-inactive-definition',
  name: 'Inactive definition',
  equipmentSensitive: false,
}
const reportCandidates = activeReportExerciseDefinitions(
  [
    templateB,
    {
      ...templateD,
      exercises: [
        { ...sharedTemplateExercise('synthetic-duplicate-slot'), name: 'Stale template label' },
        {
          id: 'synthetic-arbitrary-slot',
          exerciseId: arbitraryDefinition.id,
          name: 'Stale arbitrary label',
          prescription: '2 × 10–12',
          defaultSets: 2,
        },
      ],
    },
  ],
  [sharedDefinition, arbitraryDefinition, inactiveDefinition],
)
assertDeepEqual(
  reportCandidates.map((definition) => [definition.id, definition.name]),
  [
    [sharedDefinition.id, sharedDefinition.name],
    [arbitraryDefinition.id, arbitraryDefinition.name],
  ],
  'CoachReport candidates pochodzą z aktywnych exact exerciseId, deduplikują ID i używają nazw definicji',
)
assert(
  !reportCandidates.some((definition) => definition.id === inactiveDefinition.id),
  'nieaktywna historyczna konfiguracja nie może wejść do CoachReport',
)

const legacyTemplates = clone(legacyTemplatesFixture)
const sameNamedCandidates = activeReportExerciseDefinitions([
  { ...templateB, exercises: [
    sharedTemplateExercise('first'),
    { ...sharedTemplateExercise('second'), exerciseId: replacementDefinition.id },
    { ...sharedTemplateExercise(sharedDefinition.id), exerciseId: undefined },
    { ...sharedTemplateExercise('unknown'), exerciseId: 'missing-definition' },
  ] },
], [sharedDefinition, { ...replacementDefinition, name: sharedDefinition.name, aliases: [sharedDefinition.name] }])
assertDeepEqual(sameNamedCandidates.map((item) => item.id), [sharedDefinition.id, replacementDefinition.id], 'report keeps equal names/aliases separate and excludes unresolved references without slot fallback')
const invalidReplacement = updateTemplateAndLibrary(identityUpdateData, {
  ...templateD,
  exercises: [{ ...templateD.exercises[0], exerciseId: 'missing-definition', name: 'Unknown' }],
})
assertDeepEqual(invalidReplacement.library, identityUpdateData.exerciseLibrary, 'invalid replacement cannot manufacture a definition')
assertDeepEqual(invalidReplacement.templates, identityUpdateData.templates, 'invalid replacement preserves both templates')
const legacyWorkouts = clone(legacyWorkoutsFixture)

const templatesBefore = clone(legacyTemplates)
const workoutsBefore = clone(legacyWorkouts)
const sourceSnapshot = JSON.stringify({ templates: legacyTemplates, workouts: legacyWorkouts })

const migrated = migrateLegacyExerciseIdentity(legacyTemplates, legacyWorkouts)

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

const previousDesktopSeed = migrateLegacyExerciseIdentity(withoutExerciseIds(clone(core.DEFAULT_TEMPLATES)), [])
assertDeepEqual(initialDesktopData.templates, previousDesktopSeed.templates, 'Desktop seed zachowuje dokładne canonical semantics z v3')
assertDeepEqual(initialDesktopData.exerciseLibrary, previousDesktopSeed.exerciseLibrary, 'Desktop seed zachowuje dokładną bibliotekę 28 definicji z v3')

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

const migratedAgain = migrateLegacyExerciseIdentity(migrated.templates, migrated.workouts, migrated.exerciseLibrary)
assertDeepEqual(migratedAgain, migrated, 'migracja musi być idempotentna')

assertEqual(normalizeExerciseName('  WIOSŁO   na WYCIĄGU  '), 'wiosło na wyciągu', 'normalizacja trim/case/spaces')
assert(
  normalizeExerciseName('Wiosło na wyciągu') !== normalizeExerciseName('Wiosło na maszynie'),
  'normalizacja nie może wykonywać fuzzy merge',
)

const semanticReplacement = migrateLegacyExerciseIdentity(
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

const currentV4WithUnresolved = {
  ...clone(legacyV2Fixture),
  version: 4,
  exerciseLibrary: [] as ExerciseDefinition[],
}
const currentV4Snapshot = clone(currentV4WithUnresolved)
const normalizedCurrentV4 = normalizeData(currentV4WithUnresolved)
assertDeepEqual(normalizedCurrentV4.workouts, currentV4Snapshot.workouts, 'Store v4 nie może automatycznie poprawiać historii bez exerciseId')
assertDeepEqual(normalizedCurrentV4.templates, currentV4Snapshot.templates, 'Store v4 nie może automatycznie poprawiać szablonów bez exerciseId')
assertDeepEqual(currentV4WithUnresolved, currentV4Snapshot, 'normalizacja Store v4 nie może mutować danych wejściowych')

const definition = (name: string) => {
  const normalized = normalizeExerciseName(name)
  const matches = migrated.exerciseLibrary.filter((item) => normalizeExerciseName(item.name) === normalized)
  assertEqual(matches.length, 1, `brak jednoznacznej definicji fixture: ${name}`)
  return matches[0]
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
  {
    beforeOrOn: '2026-01-04',
    exerciseLibrary: migrated.exerciseLibrary,
    gymLocation: 'Klub Północ',
  },
)
assertEqual(sharedPressPrevious.latest?.workout.id, 'fixture-workout-d-2', 'A→D→A: najnowszy wynik ma pochodzić z D')
assertEqual(sharedPressPrevious.comparable?.workout.id, 'fixture-workout-d-2', 'wolny ciężar porównuje wynik między siłowniami')
assertEqual(sharedPressPrevious.comparable?.exercise.sets[0].reps, 12, 'A→D→A zwraca 10×12, nie starsze 10×10')

const cablePrevious = previousExerciseOccurrence(
  migrated.workouts,
  activeReference(cableRowA),
  {
    beforeOrOn: '2026-01-04',
    exerciseLibrary: migrated.exerciseLibrary,
    gymLocation: 'Klub Północ',
  },
)
assertEqual(cablePrevious.latest?.workout.id, 'fixture-workout-d-2', 'latest pokazuje najnowsze wykonanie canonical exercise')
assertEqual(cablePrevious.comparable?.workout.id, 'fixture-workout-a-1', 'maszyna/wyciąg wybiera ostatni wynik z tej samej siłowni')
assertEqual(cablePrevious.comparable?.exercise.sets[0].weight, 80, 'powrót do Klubu Północ zwraca 80×8')
assert(!exercisesMatch(machineWorkoutExercise, activeReference(cableRowA), migrated.exerciseLibrary), '100×9 z Wiosła na maszynie nie może wejść do historii wyciągu')
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
  sharedPress.id,
  migrated.exerciseLibrary,
)
assertEqual(groupedSharedOccurrences.length, 3, 'dwa refy canonical w jednej sesji liczą się jako jedna occurrence')
assertEqual(groupedSharedOccurrences[0].workout.id, duplicateCanonicalSession.id, 'agregat zachowuje najnowszą sesję jako current')
assertEqual(groupedSharedOccurrences[1].workout.id, 'fixture-workout-d-2', 'previous po agregacji pochodzi z wcześniejszej sesji')
assertDeepEqual(
  groupedSharedOccurrences[0].exercise.sets.map((item) => item.id),
  ['shared-copy-set-1', 'shared-copy-set-2'],
  'agregat zachowuje wszystkie widoczne serie i ich kolejność, pomijając skipped/puste refy',
)
assertDeepEqual(
  groupedSharedOccurrences[0].exercises.map((item) => item.id),
  ['shared-copy-1', 'shared-copy-2'],
  'agregat zachowuje źródłowe referencje canonical w kolejności treningu',
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

const sameNameLibrary = registerExerciseDefinition(
  migrated.exerciseLibrary,
  { id: 'same-name-separate-id', name: cableRow.name, equipmentSensitive: true },
)
assertEqual(sameNameLibrary.at(-1)?.id, 'same-name-separate-id', 'ta sama nazwa nie może zostać zamieniona na istniejące exerciseId')

const newExerciseLibrary = registerExerciseDefinition(
  migrated.exerciseLibrary,
  { id: 'single-arm-cable-row', name: 'Wiosło na wyciągu jednorącz', equipmentSensitive: true },
)
assertEqual(newExerciseLibrary.at(-1)?.id, 'single-arm-cable-row', 'rzeczywiście nowe ćwiczenie dostaje jawny ID')
assertEqual(newExerciseLibrary.length, migrated.exerciseLibrary.length + 1, 'nowa definicja trafia do globalnej biblioteki')

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
  customDefinition.id,
  migrated.exerciseLibrary,
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
