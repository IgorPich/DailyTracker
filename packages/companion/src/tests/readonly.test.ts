import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { FakeCompanionModel } from '../model/fakeCompanionModel.ts'
import { applicationEventTrigger, createReadOnlyCompanion, spontaneousCompanionTrigger, userDialogueInput,
  type CompanionReadOnlyRequest } from '../readonly/runtime.ts'
import { createExplicitCommandSession, explicitUserCommandInput } from '../commands/explicitCommand.ts'

const fixture = (output?: unknown) => {
  const id = randomUUID(), evidence = [{ id, text: 'Synthetic supplied fact' }]
  const response = output ?? { message: 'Synthetic informational response', evidenceIds: [id] }
  return { id, evidence, response, runtime: createReadOnlyCompanion({ readEvidence: async () => evidence }, new FakeCompanionModel(response)) }
}

test('three distinct typed input paths yield deterministic communication only', async () => {
  const f = fixture()
  const expected = { status: 'MESSAGE', response: f.response }
  assert.deepEqual(await f.runtime.dialogue(userDialogueInput('Question about facts')), expected)
  assert.deepEqual(await f.runtime.dialogue(userDialogueInput('Question about facts')), expected)
  assert.deepEqual(await f.runtime.spontaneous(spontaneousCompanionTrigger()), expected)
  assert.deepEqual(await f.runtime.applicationEvent(applicationEventTrigger('WORKOUT_SAVED')), expected)
  assert.deepEqual(await f.runtime.applicationEvent(applicationEventTrigger('TRAINER_CONTEXT_UPDATED')), expected)
  assert.deepEqual(Object.keys(f.runtime).sort(), ['applicationEvent', 'dialogue', 'spontaneous'])
  assert.deepEqual(Object.keys(f.response).sort(), ['evidenceIds', 'message'])
})

test('mutation-like dialogue is text, never promoted to a command or proposed action', async () => {
  const f = fixture({ message: 'Use the deliberate command workflow for changes.', evidenceIds: [] })
  const before = structuredClone(f.evidence)
  const result = await f.runtime.dialogue(userDialogueInput('zmień zakres na 10–15'))
  assert.deepEqual(result, { status: 'MESSAGE', response: f.response })
  assert.deepEqual(f.evidence, before)
  assert.equal('plan' in result, false)
  assert.equal('action' in result, false)
})

test('forged, copied, consumed and cross-capability envelopes are rejected before context/model use', async () => {
  let calls = 0, writes = 0
  const runtime = createReadOnlyCompanion({ readEvidence: async () => { calls++; return [] } }, new FakeCompanionModel({ message: 'Info', evidenceIds: [] }))
  const input = userDialogueInput('Question')
  assert.equal((await runtime.dialogue({ ...input })).status, 'INVALID')
  // @ts-expect-error spontaneous input is not dialogue
  assert.equal((await runtime.dialogue(spontaneousCompanionTrigger())).status, 'INVALID')
  // @ts-expect-error dialogue is not an application event
  assert.equal((await runtime.applicationEvent(input)).status, 'INVALID')
  // @ts-expect-error explicit commands are not dialogue
  assert.equal((await runtime.dialogue(explicitUserCommandInput('Explicit'))).status, 'INVALID')
  // @ts-expect-error trainer extraction is not dialogue
  assert.equal((await runtime.dialogue({ kind: 'TRAINER_TEXT', text: 'Trainer text' })).status, 'INVALID')
  assert.equal(calls, 0)
  assert.equal((await runtime.dialogue(input)).status, 'MESSAGE')
  assert.equal((await runtime.dialogue(input)).status, 'INVALID')
  assert.equal(calls, 1)
  const commands = createExplicitCommandSession({ supportsConfirmedTrackingMutations: true,
    changeTemplateRepRange: async () => { writes++; return { status: 'FAILED', message: 'Unexpected' } } })
  for (const other of [userDialogueInput('Change it'), spontaneousCompanionTrigger(), applicationEventTrigger('WORKOUT_SAVED')]) {
    // @ts-expect-error read-only envelopes cannot enter explicit command preparation
    assert.equal((await commands.prepare(other, { templates: [], exerciseLibrary: [] }, { propose: async () => { calls++; return {} } })).status, 'INVALID')
  }
  assert.equal(calls, 1); assert.equal(writes, 0)
})

test('closed schema rejects actions, arbitrary fields, invalid structures and unknown evidence', async () => {
  const bad = [null, [], {}, { message: '', evidenceIds: [] }, { message: 42, evidenceIds: [] },
    { message: 'Info', evidenceIds: [randomUUID()] }, { message: 'Info', evidenceIds: [null] },
    { message: 'Info', evidenceIds: new Array(1) }, { message: 'Info', evidenceIds: [], action: 'CHANGE_TEMPLATE_REP_RANGE' },
    { message: 'Info', evidenceIds: [], commands: [] }, { message: 'Info', evidenceIds: [], payload: {} },
    { message: 'Info', evidenceIds: [], category: 'unknown' }]
  for (const output of bad) {
    const f = fixture(output)
    // null is explicitly passed here because fixture's default uses nullish coalescing.
    const runtime = createReadOnlyCompanion({ readEvidence: async () => f.evidence }, new FakeCompanionModel(output))
    assert.equal((await runtime.dialogue(userDialogueInput('Question'))).status, 'INVALID')
    assert.equal((await runtime.spontaneous(spontaneousCompanionTrigger())).status, 'INVALID')
    assert.equal((await runtime.applicationEvent(applicationEventTrigger('WORKOUT_SAVED'))).status, 'INVALID')
  }
  const f = fixture()
  const runtime = createReadOnlyCompanion({ readEvidence: async () => f.evidence }, new FakeCompanionModel({ message: 'Info', evidenceIds: [f.id, f.id] }))
  assert.equal((await runtime.dialogue(userDialogueInput('Question'))).status, 'INVALID')
})

test('provider receives a detached typed minimal request; cannot alter context allowlist', async () => {
  const f = fixture()
  let requestSeen: CompanionReadOnlyRequest | undefined
  const runtime = createReadOnlyCompanion({ readEvidence: async () => f.evidence }, { propose: async (request) => {
    requestSeen = request
    assert.deepEqual(Object.keys(request).sort(), ['evidence', 'input', 'kind'])
    assert.equal(request.kind, 'COMPANION_READ_ONLY')
    ;(request.evidence as { id: string; text: string }[]).push({ id: 'invented-reference', text: 'Not provided' })
    return { message: 'Info', evidenceIds: ['invented-reference'] }
  } })
  assert.equal((await runtime.dialogue(userDialogueInput('Question'))).status, 'INVALID')
  assert.equal(requestSeen?.input.kind, 'USER_DIALOGUE')
  assert.equal(f.evidence.length, 1)
  const result = await f.runtime.dialogue(userDialogueInput('Question'))
  if (result.status !== 'MESSAGE') assert.fail()
  assert.ok(Object.isFrozen(result.response)); assert.ok(Object.isFrozen(result.response.evidenceIds))
})

test('context/provider failures fail closed, without retries or silent context expansion', async () => {
  let calls = 0
  const model = { propose: async () => { calls++; return { message: 'Info', evidenceIds: [] } } }
  const duplicate = { id: randomUUID(), text: 'Fact' }
  for (const readEvidence of [async () => { throw new Error('Offline') }, async () => [duplicate, duplicate],
    async () => [{ ...duplicate, rawAppData: {} }]]) {
    assert.equal((await createReadOnlyCompanion({ readEvidence }, model).dialogue(userDialogueInput('Question'))).status, 'INVALID')
  }
  assert.equal(calls, 0)
  const runtime = createReadOnlyCompanion({ readEvidence: async () => [] }, { propose: async () => { calls++; throw new Error('Unavailable') } })
  assert.equal((await runtime.dialogue(userDialogueInput('Question'))).status, 'INVALID'); assert.equal(calls, 1)
})

test('read-only module import boundary allows only the type-only model port; no command barrel leakage', () => {
  const directory = new URL('../readonly/', import.meta.url)
  for (const name of readdirSync(directory)) {
    assert.match(name, /\.ts$/)
    const source = readFileSync(new URL(name, directory), 'utf8')
    const imports = source.match(/^import .*$/gm) ?? []
    assert.deepEqual(imports, ["import type { CompanionModel } from '../ports/companionModel.ts'"])
    assert.doesNotMatch(source, /ActionDefinitionRegistry|TrackingCommandGateway|ConfirmedActionPlan|ProposedActionDraft|AppDataStore|\.\/commands|import\(|require\(|fetch\(|invoke\(/)
    assert.doesNotMatch(source, /export\s+.*from\s/)
  }
  const extraction = readFileSync(new URL('../extraction/proposeCoachDraftsFromNote.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(extraction, /ActionDefinitionRegistry|TrackingCommandGateway|commands\//)
  const barrel = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(barrel, /commands\/|readonly\//)
})
