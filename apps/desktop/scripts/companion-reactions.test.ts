import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { observeCommandReaction, reactionSnapshot } from '../src/services/companionReactions.ts'
import { createMemoryApplication, type MemoryState, withCompanionMemory } from '@greekgod/companion/memory'
import { createReadOnlyCompanion, userDialogueInput, spontaneousCompanionTrigger, applicationEventTrigger } from '@greekgod/companion/readonly'
import { FakeCompanionModel } from '@greekgod/companion'
import { observeReadOnlyReaction } from '../src/services/companionReactions.ts'

test('command observer presents outcomes without throwing, retries or mutation capabilities', () => {
  observeCommandReaction('APPLIED')
  assert.equal(reactionSnapshot(false).presentation.semanticReaction, 'POSITIVE')
  for (const status of ['FAILED', 'STALE', 'INDETERMINATE', 'BLOCKED'] as const) {
    assert.doesNotThrow(() => observeCommandReaction(status))
    assert.equal(reactionSnapshot(true).presentation.semanticReaction, 'CONCERNED')
  }
  // Invalid input also cannot propagate a presentation failure into a persisted command result.
  assert.doesNotThrow(() => observeCommandReaction('INVALID' as 'APPLIED'))
})
test('read-only reactions with real memory reader leave accepted memory unchanged', async () => {
  let memory: MemoryState = { version: 1, items: [] }, writes = 0
  const app = createMemoryApplication({ read: async () => structuredClone(memory), update: async (change) => {
    memory = await change(structuredClone(memory)); writes++; return structuredClone(memory)
  } }, async () => ({ exerciseIds: [], coachItemIds: [] }), () => '2026-01-01T00:00:00.000Z', randomUUID)
  await app.addExplicit({ content: { kind: 'SUMMARY_STYLE', value: 'SHORT' }, scope: { kind: 'GLOBAL' }, expiresAt: null })
  const before = structuredClone(memory), previousWrites = writes
  const reader = withCompanionMemory({ readEvidence: async () => [] }, app.reader, { kind: 'GLOBAL' }, '2026-01-01T00:00:00.000Z')
  const runtime = createReadOnlyCompanion(reader, new FakeCompanionModel({ message: 'Synthetic information', evidenceIds: [] }))
  const results = [await runtime.dialogue(userDialogueInput('Question')), await runtime.spontaneous(spontaneousCompanionTrigger()),
    await runtime.applicationEvent(applicationEventTrigger('WORKOUT_SAVED'))]
  for (const [index, source] of (['USER_DIALOGUE', 'SPONTANEOUS', 'APPLICATION_EVENT'] as const).entries()) observeReadOnlyReaction(source, results[index].status)
  assert.deepEqual(memory, before); assert.equal(writes, previousWrites)
})
test('Desktop waits for actual command result before presentation; preview/extraction do not publish reactions', () => {
  const page = readFileSync(new URL('../src/pages/ExplicitCommand.tsx', import.meta.url), 'utf8')
  const body = page.slice(page.indexOf('const apply ='))
  assert.ok(body.indexOf('await session.execute(session.confirm(result))') < body.indexOf('observeCommandReaction(executed.status)'))
  assert.match(body, /const executed = await session.execute\(session.confirm\(result\)\)/)
  assert.doesNotMatch(page.slice(page.indexOf('const prepare ='), page.indexOf('const apply =')), /observeCommandReaction/)
  const observer = readFileSync(new URL('../src/services/companionReactions.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(observer, /ActionDefinitionRegistry|TrackingCommandGateway|\.execute\(|\.save\(|Repository|\/commands|\/memory|invoke\(/)
  const trainer = readFileSync(new URL('../src/pages/HumanCoach.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(trainer, /companionReactions|observeCommandReaction/)
  const surface = readFileSync(new URL('../src/pages/CompanionReactions.tsx', import.meta.url), 'utf8')
  assert.match(surface, /reducedMotion/); assert.match(surface, /clearInterval/)
  assert.doesNotMatch(surface, /\.save\(|Repository|trackingCommands|\.png|\.gif|\.webm|animation/)
})
