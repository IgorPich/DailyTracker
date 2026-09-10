import type { ExerciseDefinition, TrainingTemplate, Workout } from '../src/types'

const runAudit = async () => {
  if (!process.argv.includes('--read-only')) {
    console.log('SKIP live Store: uruchom jawnie z flagą --read-only')
    return
  }

  const [{ existsSync, readFileSync }, { join }, { createHash }, dataMigration, exerciseIdentity] = await Promise.all([
    import('node:fs'),
    import('node:path'),
    import('node:crypto'),
    import('../src/utils/dataMigration'),
    import('../src/utils/exerciseIdentity'),
  ])
  const { migrateLegacyExerciseIdentity } = dataMigration
  const { normalizeExerciseName } = exerciseIdentity

  const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
    if (!condition) throw new Error(`FAIL live Store audit: ${message}`)
  }
  const assertDeepEqual = (actual: unknown, expected: unknown, message: string) => {
    assert(JSON.stringify(actual) === JSON.stringify(expected), message)
  }
  const withoutExerciseIds = <T extends TrainingTemplate[] | Workout[]>(items: T): T => items.map((item) => ({
    ...item,
    exercises: item.exercises.map((exercise) => {
      const { exerciseId: _exerciseId, ...snapshot } = exercise
      return snapshot
    }),
  })) as T

  const appDataDirectory = process.env.APPDATA
  if (!appDataDirectory) {
    console.log('SKIP live Store: brak zmiennej APPDATA')
    return
  }
  const storePath = process.env.GREEKGOD_STORE_PATH
    ?? join(appDataDirectory, 'com.igorpich.formlog', 'formlog.store.json')
  if (!existsSync(storePath)) {
    console.log(`SKIP live Store: plik nie istnieje (${storePath})`)
    return
  }

  const rawBefore = readFileSync(storePath, 'utf8')
  const hashBefore = createHash('sha256').update(rawBefore).digest('hex').toUpperCase()
  const parsed = JSON.parse(rawBefore) as { appData?: Record<string, unknown> }
  const liveData = parsed.appData
  assert(liveData, 'brak appData')
  assert(Array.isArray(liveData.templates), 'brak templates')
  assert(Array.isArray(liveData.workouts), 'brak workouts')
  assert(Array.isArray(liveData.dailyEntries), 'brak dailyEntries')

  const liveTemplates = liveData.templates as TrainingTemplate[]
  const liveWorkouts = liveData.workouts as Workout[]
  const liveLibrary = Array.isArray(liveData.exerciseLibrary)
    ? liveData.exerciseLibrary as ExerciseDefinition[]
    : []
  const sourceSnapshot = structuredClone({
    templates: liveTemplates,
    workouts: liveWorkouts,
    exerciseLibrary: liveLibrary,
  })

  const migrated = migrateLegacyExerciseIdentity(liveTemplates, liveWorkouts, liveLibrary)
  assertDeepEqual(
    { templates: liveTemplates, workouts: liveWorkouts, exerciseLibrary: liveLibrary },
    sourceSnapshot,
    'migracja zmodyfikowała obiekty wejściowe',
  )
  assertDeepEqual(
    withoutExerciseIds(migrated.templates),
    withoutExerciseIds(sourceSnapshot.templates),
    'migracja zmieniła istniejące pola szablonów',
  )
  assertDeepEqual(
    withoutExerciseIds(migrated.workouts),
    withoutExerciseIds(sourceSnapshot.workouts),
    'migracja zmieniła istniejące pola treningów lub serii',
  )
  if (Number(liveData.version) >= 4) {
    assertDeepEqual(migrated.templates, sourceSnapshot.templates, 'Store v4 wymagał ponownej migracji szablonów')
    assertDeepEqual(migrated.workouts, sourceSnapshot.workouts, 'Store v4 wymagał ponownej migracji treningów')
    assertDeepEqual(
      migrated.exerciseLibrary,
      sourceSnapshot.exerciseLibrary,
      'Store v4 wymagał ponownej migracji biblioteki ćwiczeń',
    )
  }

  const migratedAgain = migrateLegacyExerciseIdentity(migrated.templates, migrated.workouts, migrated.exerciseLibrary)
  assertDeepEqual(migratedAgain, migrated, 'migracja nie jest idempotentna')
  const normalizedNames = migrated.exerciseLibrary.map((definition) => normalizeExerciseName(definition.name))
  assert(new Set(normalizedNames).size === normalizedNames.length, 'biblioteka zawiera powtórzone nazwy canonical')

  const rawAfter = readFileSync(storePath, 'utf8')
  const hashAfter = createHash('sha256').update(rawAfter).digest('hex').toUpperCase()
  assert(rawAfter === rawBefore && hashAfter === hashBefore, 'plik zmienił się podczas audytu')
  console.log(
    `PASS live Store read-only: v${String(liveData.version)}, ${liveWorkouts.length} workouts, `
    + `${(liveData.dailyEntries as unknown[]).length} daily entries, SHA256 ${hashAfter}`,
  )
}

if (process.env.GREEKGOD_STORE_AUDIT_VITE === '1') {
  await runAudit()
} else {
  process.env.GREEKGOD_STORE_AUDIT_VITE = '1'
  const { createServer } = await import('vite')
  const server = await createServer({
    root: process.cwd(),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })
  try {
    await server.ssrLoadModule('/scripts/live-store-audit.ts')
  } finally {
    await server.close()
  }
}
