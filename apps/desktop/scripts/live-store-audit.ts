import type { ExerciseDefinition, TrainingTemplate, Workout } from '../src/types'

const runAudit = async () => {
  if (!process.argv.includes('--read-only')) {
    console.log('SKIP live Store: uruchom jawnie z flagą --read-only')
    return
  }

  const [{ existsSync, readFileSync }, { extname, join }, { createHash }, { DatabaseSync }, dataMigration, core] = await Promise.all([
    import('node:fs'),
    import('node:path'),
    import('node:crypto'),
    import('node:sqlite'),
    import('../src/utils/dataMigration'),
    import('@greekgod/core'),
  ])
  const { migrateLegacyExerciseIdentity } = dataMigration
  const { auditExerciseIdentities } = core

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
  const storeDirectory = join(appDataDirectory, 'com.igorpich.formlog')
  const sqlitePath = join(storeDirectory, 'greekgod-v3.sqlite')
  const legacyPath = join(storeDirectory, 'formlog.store.json')
  const storePath = process.env.GREEKGOD_STORE_PATH
    ?? (existsSync(sqlitePath) ? sqlitePath : legacyPath)
  if (!existsSync(storePath)) {
    console.log(`SKIP live Store: plik nie istnieje (${storePath})`)
    return
  }

  const rawBefore = readFileSync(storePath)
  const hashBefore = createHash('sha256').update(rawBefore).digest('hex').toUpperCase()
  const isSqlite = extname(storePath).toLocaleLowerCase() === '.sqlite'
  let liveData: Record<string, unknown> | undefined
  if (isSqlite) {
    const database = new DatabaseSync(storePath, { readOnly: true })
    try {
      const integrity = database.prepare('PRAGMA integrity_check').get() as { integrity_check?: string }
      assert(integrity.integrity_check === 'ok', 'SQLite integrity_check nie zwrócił ok')
      const row = database.prepare(`
        SELECT data_version, payload_json
        FROM app_data
        WHERE singleton_id = 1
      `).get() as { data_version?: number; payload_json?: string } | undefined
      assert(row && typeof row.payload_json === 'string', 'SQLite nie zawiera aktualnego app_data')
      liveData = JSON.parse(row.payload_json) as Record<string, unknown>
      assert(Number(liveData.version) === row.data_version, 'data_version SQLite nie zgadza się z payloadem')
    } finally {
      database.close()
    }
  } else {
    const parsed = JSON.parse(rawBefore.toString('utf8')) as { appData?: Record<string, unknown> }
    liveData = parsed.appData
  }
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
  const identityAuditInput = { templates: liveTemplates, workouts: liveWorkouts, exerciseLibrary: liveLibrary }
  const identityAuditSnapshot = structuredClone(identityAuditInput)
  const identityAudit = auditExerciseIdentities(identityAuditInput)
  assertDeepEqual(identityAuditInput, identityAuditSnapshot, 'audyt identity zmodyfikował dane wejściowe')

  if (Number(liveData.version) < 4) {
    const migrated = migrateLegacyExerciseIdentity(liveTemplates, liveWorkouts, liveLibrary)
    assertDeepEqual(
      { templates: liveTemplates, workouts: liveWorkouts, exerciseLibrary: liveLibrary },
      sourceSnapshot,
      'legacy migration zmodyfikowała obiekty wejściowe',
    )
    assertDeepEqual(
      withoutExerciseIds(migrated.templates),
      withoutExerciseIds(sourceSnapshot.templates),
      'legacy migration zmieniła istniejące pola szablonów',
    )
    assertDeepEqual(
      withoutExerciseIds(migrated.workouts),
      withoutExerciseIds(sourceSnapshot.workouts),
      'legacy migration zmieniła istniejące pola treningów lub serii',
    )
    const migratedAgain = migrateLegacyExerciseIdentity(migrated.templates, migrated.workouts, migrated.exerciseLibrary)
    assertDeepEqual(migratedAgain, migrated, 'legacy migration nie jest idempotentna')
  }

  const rawAfter = readFileSync(storePath)
  const hashAfter = createHash('sha256').update(rawAfter).digest('hex').toUpperCase()
  assert(rawAfter.equals(rawBefore) && hashAfter === hashBefore, 'plik zmienił się podczas audytu')
  console.log(
    `PASS live ${isSqlite ? 'SQLite' : 'legacy JSON'} Store read-only: v${String(liveData.version)}, ${liveWorkouts.length} workouts, `
    + `${(liveData.dailyEntries as unknown[]).length} daily entries, `
    + `identity ${identityAudit.resolvedReferences}/${identityAudit.totalReferences} resolved, `
    + `${identityAudit.unresolvedReferences} unresolved, SHA256 ${hashAfter}`,
  )
  if (identityAudit.unresolvedReferences) {
    const reasons = identityAudit.issues.reduce<Record<string, number>>((counts, issue) => ({
      ...counts,
      [issue.reason]: (counts[issue.reason] ?? 0) + 1,
    }), {})
    console.log(`Identity data-quality classifications: ${JSON.stringify(reasons)}`)
  }
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
