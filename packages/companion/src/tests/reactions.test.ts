import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createReactionCoordinator, commandOutcomeReaction, readOnlyReaction, REACTION_POLICY_V1, SEMANTIC_REACTIONS, type ReactionRequest } from '../reactions/coordinator.ts'
import { FakeCompanionModel } from '../model/fakeCompanionModel.ts'
import { createReadOnlyCompanion, userDialogueInput, spontaneousCompanionTrigger, applicationEventTrigger, type CompanionReadOnlyRequest } from '../readonly/runtime.ts'

const request = (overrides: Partial<ReactionRequest> = {}): ReactionRequest => ({ id: randomUUID(), semanticReaction: 'ACKNOWLEDGE',
  source: 'USER_DIALOGUE', priority: 'LOW', createdAt: 0, evidenceIds: [randomUUID()], ...overrides })

test('closed semantic requests reject unknown reactions, priority, sources and model presentation fields', () => {
  assert.deepEqual(SEMANTIC_REACTIONS, ['NEUTRAL', 'ACKNOWLEDGE', 'POSITIVE', 'CONCERNED'])
  const coordinator = createReactionCoordinator()
  for (const bad of [{ ...request(), semanticReaction: 'DANCE' }, { ...request(), priority: 'UNLIMITED' },
    { ...request(), source: 'TRAINER_TEXT' }, { ...request(), css: 'flash' }, { ...request(), duration: 50 },
    { ...request(), asset: 'avatar.png' }, { ...request(), createdAt: NaN }, { ...request(), evidenceIds: new Array(1) }]) {
    assert.throws(() => coordinator.submit(bad as ReactionRequest, 0))
  }
  assert.equal(coordinator.snapshot(0, false).presentation.semanticReaction, 'NEUTRAL')
})
test('low from neutral, cooldown, expiry to neutral and exact cooldown boundary', () => {
  const c = createReactionCoordinator(), first = request()
  assert.equal(c.submit(first, 0), 'DISPLAYED')
  assert.equal(c.submit(request({ createdAt: 1 }), 1), 'SUPPRESSED')
  assert.equal(c.snapshot(REACTION_POLICY_V1.lifetimeMs, false).presentation.semanticReaction, 'NEUTRAL')
  assert.equal(c.submit(request({ createdAt: 4_000 }), 4_000), 'SUPPRESSED')
  assert.equal(c.submit(request({ createdAt: REACTION_POLICY_V1.cooldownMs }), REACTION_POLICY_V1.cooldownMs), 'DISPLAYED')
  assert.equal(c.snapshot(8_000, false).suppressedCount, 2)
  assert.equal(first.createdAt, 0)
})
test('higher priority preempts; lower queues/coalesces and never interrupts high', () => {
  const c = createReactionCoordinator()
  c.submit(request(), 0)
  const high = request({ semanticReaction: 'CONCERNED', priority: 'HIGH', createdAt: 1 })
  assert.equal(c.submit(high, 1), 'DISPLAYED')
  const low = request({ semanticReaction: 'POSITIVE', createdAt: 2 })
  assert.equal(c.submit(low, 2), 'QUEUED')
  assert.equal(c.submit(request({ semanticReaction: 'POSITIVE', createdAt: 3 }), 3), 'SUPPRESSED')
  assert.equal(c.snapshot(3, false).presentation.token, high.id)
  assert.equal(c.snapshot(3, false).queuedCount, 1)
  assert.equal(c.snapshot(3_001, false).presentation.token, low.id)
  assert.equal(c.snapshot(6_001, false).presentation.semanticReaction, 'NEUTRAL')
})
test('obsolete queued requests expire even after a long inactive presenter interval', () => {
  const c = createReactionCoordinator()
  c.submit(request({ priority: 'HIGH' }), 0)
  c.submit(request({ semanticReaction: 'POSITIVE', createdAt: 1 }), 1)
  const state = c.snapshot(10_001, false)
  assert.equal(state.queuedCount, 0); assert.equal(state.expiredCount, 1)
  assert.equal(state.presentation.semanticReaction, 'NEUTRAL')
  assert.equal(c.submit(request({ createdAt: 0 }), 10_001), 'DROPPED')
  assert.throws(() => c.snapshot(1, false), /monotonic/)
  assert.throws(() => c.submit(request({ createdAt: 20_000 }), 10_001), /Future/)
})
test('deterministic ordering, bounded queue and reduced motion preserve semantics', () => {
  const inputs = [request({ priority: 'HIGH' }), request({ semanticReaction: 'POSITIVE' }), request({ priority: 'NORMAL', semanticReaction: 'CONCERNED' })]
  const run = (reducedMotion: boolean) => {
    const c = createReactionCoordinator(); inputs.forEach((input) => c.submit(input, 0))
    for (let index = 0; index < 100; index++) c.submit(request(), 0)
    const state = c.snapshot(3_000, reducedMotion)
    assert.ok(state.queuedCount <= REACTION_POLICY_V1.maxQueued)
    return state
  }
  const first = run(false), second = run(true)
  assert.equal(first.presentation.token, inputs[2].id)
  assert.deepEqual(first, { ...second, presentation: { ...second.presentation, reducedMotion: false } })
})
test('unchanged read-only schema rejects asset/CSS/timing/priority/reaction fields and all paths stay informational', async () => {
  const id = randomUUID(), reader = { readEvidence: async () => [{ id, text: 'Synthetic fact' }] }
  for (const field of ['asset', 'animation', 'css', 'color', 'duration', 'priority', 'reaction']) {
    const runtime = createReadOnlyCompanion(reader, new FakeCompanionModel({ message: 'Info', evidenceIds: [], [field]: 'anything' }))
    assert.equal((await runtime.dialogue(userDialogueInput('Info'))).status, 'INVALID')
  }
  const fake = new FakeCompanionModel<CompanionReadOnlyRequest>({ message: 'Info', evidenceIds: [id] })
  const runtime = createReadOnlyCompanion(reader, fake)
  const results = [await runtime.dialogue(userDialogueInput('Change something')), await runtime.spontaneous(spontaneousCompanionTrigger()),
    await runtime.applicationEvent(applicationEventTrigger('WORKOUT_SAVED'))]
  for (const [index, source] of (['USER_DIALOGUE', 'SPONTANEOUS', 'APPLICATION_EVENT'] as const).entries()) {
    const reaction = readOnlyReaction(source, results[index].status, { id: randomUUID(), createdAt: 0, evidenceIds: [id] })
    assert.equal(reaction.semanticReaction, 'ACKNOWLEDGE')
    assert.deepEqual(reaction.evidenceIds, [id])
    assert.equal('action' in results[index], false)
  }
})
test('only APPLIED maps to positive command outcome; failure states produce presentation data, never retries', () => {
  const metadata = { id: randomUUID(), createdAt: 0, evidenceIds: [] }
  assert.equal(commandOutcomeReaction('APPLIED', metadata).semanticReaction, 'POSITIVE')
  for (const status of ['FAILED', 'STALE', 'INDETERMINATE', 'BLOCKED'] as const) {
    const reaction = commandOutcomeReaction(status, metadata)
    assert.equal(reaction.semanticReaction, 'CONCERNED'); assert.equal(reaction.priority, 'HIGH')
    assert.deepEqual(Object.keys(reaction).sort(), ['createdAt', 'evidenceIds', 'id', 'priority', 'semanticReaction', 'source'])
  }
})
test('reaction modules import no capabilities, storage, memory, model or platform; command/extraction boundaries unchanged', () => {
  for (const file of readdirSync(new URL('../reactions/', import.meta.url))) {
    const source = readFileSync(new URL(`../reactions/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /\bimport\b|\brequire\(|ActionDefinitionRegistry|TrackingCommandGateway|ConfirmedActionPlan|AppDataStore|fetch\(|invoke\(|Date\.|performance\.|localStorage/)
  }
  const extraction = readFileSync(new URL('../extraction/proposeCoachDraftsFromNote.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(extraction, /reactions\/|ActionDefinitionRegistry|TrackingCommandGateway/)
  const memory = readFileSync(new URL('../memory/memory.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(memory, /reactions\//)
})
