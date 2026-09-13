import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createHumanCoach, emptyHumanCoachContext, type HumanCoachContext } from '@greekgod/human-coach'
import { LocalHumanCoachRepository } from '../src/services/humanCoachRepository.ts'
import { createHumanCoachLocalStorage, humanCoachStorageName, type HumanCoachStorageEnvironment } from '../src/services/humanCoachStorage.ts'

const fixture = (native: boolean) => {
  const files = new Map<string, string>()
  let writes = 0
  let failWrite = false
  let locks = 0
  const env: HumanCoachStorageEnvironment = {
    native,
    exists: async (name) => files.has(name),
    readFile: async (name) => files.get(name)!,
    saveContext: async (name, context) => {
      if (failWrite) throw new Error('Synthetic disk failure')
      writes++
      files.set(name, JSON.stringify({ context }))
    },
    browserStorage: () => ({ getItem: (name) => files.get(name) ?? null, setItem: (name, text) => {
      if (failWrite) throw new Error('Synthetic quota failure')
      writes++
      files.set(name, text)
    } }),
    browserLock: async (_name, operation) => { locks++; return operation() },
  }
  const repository = () => new LocalHumanCoachRepository(createHumanCoachLocalStorage(true, env))
  return { files, repository, writes: () => writes, locks: () => locks, fail: (value: boolean) => { failWrite = value } }
}
const note = () => ({ id: randomUUID(), text: '  Untouched trainer source\n', provenance: { sourceType: 'TRAINER_TEXT' as const, createdAt: '2026-01-01T12:00:00.000Z' } })

for (const native of [true, false]) {
  test(`${native ? 'Native' : 'Browser'} trainer ingestion and all draft links survive restart in unchanged v1 storage`, async () => {
    const f = fixture(native)
    const exerciseId = randomUUID()
    const app = createHumanCoach(f.repository(), { readExerciseIds: () => [exerciseId] })
    const source = note()
    await app.ingestTrainerText({ id: source.id, text: source.text, createdAt: source.provenance.createdAt, sourceDescription: 'Original message' })
    const base = { sourceNoteId: source.id, createdAt: source.provenance.createdAt }
    const taskId = randomUUID(), targetId = randomUUID(), decisionId = randomUUID()
    await app.createDraftFromNote({ ...base, id: taskId, kind: 'TASK', title: 'Task', exerciseIds: [exerciseId] })
    await app.createDraftFromNote({ ...base, id: targetId, kind: 'TARGET', title: 'Target', specification: { type: 'REP_RANGE', scope: 'EXERCISE', exerciseId, min: 4, max: 8, unit: 'reps' } })
    await app.createDraftFromNote({ ...base, id: decisionId, kind: 'DECISION', text: 'Decision', exerciseIds: [] })
    const restarted = createHumanCoach(f.repository(), { readExerciseIds: () => [exerciseId] })
    const loaded = await restarted.listContext()
    assert.equal(loaded.version, 1)
    assert.equal(loaded.items.length, 4)
    for (const item of loaded.items.slice(1)) {
      assert.equal(item.provenance.sourceNoteId, source.id)
      assert.equal(item.provenance.sourceType, 'TRAINER_TEXT')
      assert.equal(item.acceptance.state, 'DRAFT')
    }
    for (const id of [taskId, targetId, decisionId]) await restarted.discardCoachDraft({ id })
    assert.equal((await f.repository().read()).items.length, 1)
    assert.equal((await restarted.listCoachNotes())[0].text, source.text)
    assert.deepEqual([...f.files.keys()], [humanCoachStorageName(true)])
    await assert.rejects(f.repository().update((context) => ({ ...context, items: [] })), /immutable/)
    const acceptedId = randomUUID()
    await restarted.createDraftFromNote({ ...base, id: acceptedId, kind: 'TASK', title: 'Explicitly reviewed', exerciseIds: [exerciseId] })
    await restarted.acceptCoachItem({ id: source.id, acceptedAt: base.createdAt })
    assert.equal((await f.repository().read()).items.find((item) => item.id === acceptedId)?.acceptance.state, 'DRAFT')
    await restarted.acceptCoachItem({ id: acceptedId, acceptedAt: base.createdAt })
    const accepted = (await f.repository().read()).items.find((item) => item.id === acceptedId)!
    assert.deepEqual(accepted.acceptance, { state: 'AUTHORITATIVE', acceptedAt: base.createdAt })
    assert.equal(accepted.provenance.sourceNoteId, source.id)
    assert.equal(accepted.provenance.sourceType, 'TRAINER_TEXT')
    await assert.rejects(restarted.discardCoachDraft({ id: acceptedId }))
  })
}

test('trainer Desktop wiring uses typed drafting and existing exact-selection picker, no parsing', () => {
  const page = readFileSync(new URL('../src/pages/HumanCoach.tsx', import.meta.url), 'utf8')
  assert.match(page, /service\.ingestTrainerText/)
  assert.match(page, /service\.createDraftFromNote/)
  assert.match(page, /<ExercisePicker library=\{data\.exerciseLibrary\} value=\{exerciseId\} onSelect=\{\(definition\) => setExerciseId\(definition\.id\)\}/)
  assert.match(page, /Wklej wiadomość \/ zalecenia trenera/)
  assert.match(page, /draftFrom\(item\.id, draftKind\)/)
  assert.match(page, /href=\{`#coach-\$\{item\.provenance\.sourceNoteId\}`\}/)
  assert.match(page, /service\.acceptCoachItem/)
  assert.doesNotMatch(page, /exerciseLibrary\.find\([^\n]*name|createExercise|parseTrainer|extractTrainer/)
})

for (const native of [true, false]) {
  test(`${native ? 'Native' : 'Browser'} local context round-trip, isolated namespace and no initialization writes`, async () => {
    const f = fixture(native)
    const productionText = 'Production sentinel'
    f.files.set(humanCoachStorageName(false), productionText)
    f.files.set('formlog.store.json', 'Tracking sentinel')
    const repository = f.repository()
    assert.deepEqual(await repository.read(), emptyHumanCoachContext())
    assert.equal(f.writes(), 0)
    const app = createHumanCoach(repository, { readExerciseIds: () => [] })
    const command = note()
    const saved = await app.createCoachNote(command)
    await app.acceptCoachItem({ id: command.id, acceptedAt: command.provenance.createdAt })
    const reloaded = await f.repository().read()
    assert.equal(reloaded.items[0].acceptance.state, 'AUTHORITATIVE')
    assert.equal(reloaded.items[0].kind === 'NOTE' && reloaded.items[0].text, command.text)
    assert.equal(saved.items[0].acceptance.state, 'DRAFT')
    assert.equal(f.files.get(humanCoachStorageName(false)), productionText)
    assert.equal(f.files.get('formlog.store.json'), 'Tracking sentinel')
    if (!native) assert.ok(f.locks() > 0)
  })

  test(`${native ? 'Native' : 'Browser'} corrupt/unsupported storage fails closed without overwriting`, async () => {
    const f = fixture(native)
    for (const raw of ['not json', '{}', JSON.stringify(native ? { context: { version: 2, items: [] } } : { version: 2, items: [] })]) {
      f.files.set(humanCoachStorageName(true), raw)
      const app = createHumanCoach(f.repository(), { readExerciseIds: () => [] })
      await assert.rejects(app.listContext())
      await assert.rejects(app.createCoachNote(note()))
      assert.equal(f.files.get(humanCoachStorageName(true)), raw)
      assert.equal(f.writes(), 0)
    }
  })

  test(`${native ? 'Native' : 'Browser'} serialized commands survive failure without accepting failed writes`, async () => {
    const f = fixture(native)
    const app = createHumanCoach(f.repository(), { readExerciseIds: () => [] })
    await Promise.all([app.createCoachNote(note()), app.createCoachNote(note())])
    const before = await app.listContext()
    f.fail(true)
    await assert.rejects(app.createCoachNote(note()))
    assert.deepEqual(await app.listContext(), before)
    f.fail(false)
    await app.createCoachNote(note())
    assert.equal((await app.listContext()).items.length, 3)
  })
}

test('repository prevents source replacement and returns detached snapshots', async () => {
  const f = fixture(true)
  const repository = f.repository()
  const app = createHumanCoach(repository, { readExerciseIds: () => [] })
  await app.createCoachNote(note())
  const before = await repository.read()
  await assert.rejects(repository.update((current) => ({ ...current, items: [] })))
  await assert.rejects(repository.update((current) => ({ ...current, items: current.items.map((item) => ({ ...item, text: 'replacement' })) })))
  const detached = await repository.read()
  ;(detached as { items: HumanCoachContext['items'] }).items = []
  assert.deepEqual(await repository.read(), before)
})

test('Desktop HumanCoach is read-only toward Tracking and native permissions name only isolated files', () => {
  const source = readFileSync(new URL('../src/pages/HumanCoach.tsx', import.meta.url), 'utf8')
  assert.match(source, /const \{ data \} = useApp\(\)/)
  assert.doesNotMatch(source, /updateTemplate|updateWorkout|updateSettings|replaceData|@greekgod\/analytics|fetch\(/)
  const capability = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/human-coach.json', import.meta.url), 'utf8'))
  for (const permission of capability.permissions) {
    assert.ok(['fs:allow-exists', 'fs:allow-read-text-file'].includes(permission.identifier))
    assert.deepEqual(permission.allow.map((entry: { path: string }) => entry.path), [
      `$APPDATA/${humanCoachStorageName(false)}`, `$APPDATA/${humanCoachStorageName(true)}`,
    ])
  }
})

test('native HumanCoach saves only through the atomic command; guard precedes plugin initialization', () => {
  const storage = readFileSync(new URL('../src/services/humanCoachStorage.ts', import.meta.url), 'utf8')
  assert.match(storage, /invoke\('human_coach_save'/)
  assert.doesNotMatch(storage, /plugin-store|store\.save/)
  const native = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  assert.ok(native.indexOf('desktop_instance::acquire') < native.indexOf('tauri::Builder::default()'))
  assert.match(native, /Ok\(None\) => return/)
  const atomic = readFileSync(new URL('../src-tauri/src/human_coach_storage.rs', import.meta.url), 'utf8')
  assert.match(atomic, /sync_all\(\)/)
  assert.match(atomic, /temporary\.persist\(path\)/)
  assert.doesNotMatch(atomic.split('#[cfg(test)]')[0], /File::create|fs::write|OpenOptions/)
})
