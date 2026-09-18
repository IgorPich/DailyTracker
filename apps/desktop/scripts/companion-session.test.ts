import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  appendCompanionSessionTurn,
  clearCompanionSession,
  createCompanionSession,
} from '../src/services/companionSession.ts'

const turn = {
  question: 'Ile treningów wykonałem?',
  answer: 'W zapisanych danych są 3 treningi.',
  evidence: [{ label: 'Treningi z ostatnich 30 dni', text: 'Ostatnie 30 dni: zapisano 3 treningi.' }],
}

test('application-session owner preserves transcript across repeated route changes', () => {
  let session = createCompanionSession()
  session = appendCompanionSessionTurn(session, turn)
  for (const route of ['human-coach', 'training', 'companion', 'journal', 'companion']) {
    assert.ok(route)
    assert.deepEqual(session.turns, [turn])
  }
  session = appendCompanionSessionTurn(session, { ...turn, question: 'Drugie pytanie' })
  assert.equal(session.turns.length, 2)
})

test('clear removes only transcript state and reconstructed app session starts empty', () => {
  const acceptedMemory = Object.freeze({ version: 1, items: ['accepted-memory'] })
  const humanCoach = Object.freeze({ version: 1, items: ['accepted-context'] })
  const tracking = Object.freeze({ workouts: ['workout-1'] })
  const populated = appendCompanionSessionTurn(createCompanionSession(), turn)
  assert.deepEqual(clearCompanionSession(), { turns: [] })
  assert.deepEqual(createCompanionSession(), { turns: [] })
  assert.deepEqual(acceptedMemory.items, ['accepted-memory'])
  assert.deepEqual(humanCoach.items, ['accepted-context'])
  assert.deepEqual(tracking.workouts, ['workout-1'])
  assert.equal(populated.turns.length, 1)
})

test('session snapshots retain safe presentation only and have no persistence capability', () => {
  const session = appendCompanionSessionTurn(createCompanionSession(), turn)
  assert.deepEqual(Object.keys(session.turns[0]).sort(), ['answer', 'evidence', 'question'])
  assert.deepEqual(Object.keys(session.turns[0].evidence[0]).sort(), ['label', 'text'])
  assert.equal(Object.isFrozen(session), true)
  assert.equal(Object.isFrozen(session.turns), true)
  assert.equal(Object.isFrozen(session.turns[0].evidence), true)

  const source = readFileSync(new URL('../src/services/companionSession.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /localStorage|sessionStorage|SQLite|AppData|invoke|write|save|repository|Memory|HumanCoach|sync/i)
  assert.doesNotMatch(source, /evidenceId|handle|domainId|exerciseId|templateId/i)
})

test('App owns the session while Companion remains read-only and explicit commands remain separate', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/pages/Companion.tsx', import.meta.url), 'utf8')
  assert.match(app, /useState\(createCompanionSession\)/)
  assert.match(app, /turns=\{companionSession\.turns\}/)
  assert.match(app, /appendCompanionSessionTurn/)
  assert.match(app, /onClearSession=\{\(\) => setCompanionSession\(clearCompanionSession\(\)\)\}/)
  assert.doesNotMatch(page, /useState<.*(?:DialogueTurn|CompanionSessionTurn)/)
  assert.match(page, /createReadOnlyCompanion/)
  assert.match(page, /onClick=\{onClearSession\}/)
  assert.match(page, /Historia tej rozmowy jest przechowywana tylko do zamknięcia aplikacji\./)
  assert.doesNotMatch(page, /ActionDefinitionRegistry|TrackingCommandGateway|trackingCommands|changeTemplateRepRange/)
  assert.match(app, /view === 'explicit-command'/)
})
