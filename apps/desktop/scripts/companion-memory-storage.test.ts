import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createMemoryApplication, type MemoryDraft } from '@greekgod/companion/memory'
import { FakeCompanionModel } from '@greekgod/companion'
import { LocalCompanionMemoryRepository } from '../src/services/companionMemoryRepository.ts'
import { companionMemoryFile, createCompanionMemoryStorage, type MemoryStorageEnvironment } from '../src/services/companionMemoryStorage.ts'

const NOW = '2026-01-01T00:00:00.000Z'
const draft = (): MemoryDraft => ({ content: { kind: 'SUMMARY_STYLE', value: 'SHORT' }, scope: { kind: 'GLOBAL' }, expiresAt: null })
const fixture = (native = true) => {
  const files = new Map<string, string>(); let writes = 0, fail = false
  const env: MemoryStorageEnvironment = { native, exists: async (name) => files.has(name), readFile: async (name) => files.get(name)!,
    save: async (development, memory) => { assert.equal(development, true); if (fail) throw new Error('Injected failure'); writes++; files.set(companionMemoryFile(development), JSON.stringify({ memory })) } }
  const repository = () => new LocalCompanionMemoryRepository(createCompanionMemoryStorage(true, env))
  const refs = { exerciseIds: [randomUUID()], coachItemIds: [randomUUID()] }
  const app = () => createMemoryApplication(repository(), async () => refs, () => NOW, randomUUID)
  return { files, app, refs, repository, writes: () => writes, fail: (value: boolean) => { fail = value } }
}
test('explicit and accepted memory survive isolated Desktop reopen with exact provenance; candidates do not write', async () => {
  const f = fixture(), app = f.app()
  await app.list(); assert.equal(f.writes(), 0)
  const candidate = await app.propose(new FakeCompanionModel(draft()))
  assert.equal(f.writes(), 0)
  const accepted = await app.accept(candidate)
  assert.equal(f.writes(), 1)
  assert.deepEqual(await f.app().list(), accepted)
  const sourceId = f.refs.coachItemIds[0]
  const next = await app.addExplicit({ content: { kind: 'HUMAN_COACH_REFERENCE', value: sourceId }, scope: { kind: 'HUMAN_COACH_CONTEXT', id: sourceId }, expiresAt: null })
  assert.equal(next.items[1].provenance.sourceId, sourceId)
  assert.deepEqual(await f.app().list(), next)
  assert.equal(f.files.has(companionMemoryFile(false)), false)
  assert.equal(f.files.size, 1)
})
test('corrupt/unsupported memory fails closed without replacing or initializing the file', async () => {
  for (const text of ['broken', '{}', '{"memory":{"version":2,"items":[]}}', '{"memory":{"version":1,"items":[{}]}}']) {
    const f = fixture(); f.files.set(companionMemoryFile(true), text)
    await assert.rejects(f.app().list()); await assert.rejects(f.app().addExplicit(draft()))
    assert.equal(f.files.get(companionMemoryFile(true)), text); assert.equal(f.writes(), 0)
  }
})
test('serialized memory writes survive failure without lost updates; accepted contents cannot be rewritten', async () => {
  const f = fixture(), repo = f.repository()
  const app = createMemoryApplication(repo, async () => f.refs, () => NOW, randomUUID)
  f.fail(true); await assert.rejects(app.addExplicit(draft()))
  assert.equal((await app.list()).items.length, 0)
  f.fail(false)
  await Promise.all([app.addExplicit(draft()), app.addExplicit({ ...draft(), scope: { kind: 'EXERCISE', id: f.refs.exerciseIds[0] } })])
  const state = await app.list(); assert.equal(state.items.length, 2); assert.equal(f.writes(), 2)
  await assert.rejects(repo.update((current) => ({ ...current, items: current.items.slice(1) })))
  await assert.rejects(repo.update((current) => ({ ...current, items: current.items.map((item) => ({ ...item, content: { kind: 'SUMMARY_STYLE', value: 'DETAILED' } })) })))
  assert.deepEqual(await app.list(), state)
  await app.archive(state.items[0].id)
  assert.equal((await f.app().list()).items[0].status, 'ARCHIVED')
})
test('browser preview may inspect/propose but never writes persistent memory', async () => {
  const f = fixture(false), app = f.app()
  assert.equal((await app.list()).items.length, 0)
  const candidate = await app.propose(new FakeCompanionModel(draft()))
  await assert.rejects(app.accept(candidate), /Desktop/)
  assert.equal(f.writes(), 0); assert.equal(f.files.size, 0)
})
test('Desktop memory surface and persistence are isolated from Tracking and use fixed native atomic command', () => {
  const page = readFileSync(new URL('../src/pages/CompanionMemory.tsx', import.meta.url), 'utf8')
  assert.match(page, /service\.addExplicit/); assert.match(page, /service\.accept/); assert.match(page, /service\.reject/); assert.match(page, /service\.archive/)
  assert.doesNotMatch(page, /trackingCommands|ActionDefinitionRegistry|\/commands|updateTemplate|setData|AppDataStore/)
  const storage = readFileSync(new URL('../src/services/companionMemoryStorage.ts', import.meta.url), 'utf8')
  assert.match(storage, /invoke\('companion_memory_save'/)
  assert.doesNotMatch(storage, /localStorage|human_coach_save|writeTextFile/)
  const native = readFileSync(new URL('../src-tauri/src/companion_memory_storage.rs', import.meta.url), 'utf8')
  assert.match(native, /atomic_replace\(&backup/); assert.match(native, /atomic_replace\(&target/)
  const lifecycle = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
  assert.ok(lifecycle.indexOf('desktop_instance::acquire') < lifecycle.indexOf('tauri::Builder::default'))
})
