import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createReadOnlyCompanion, userDialogueInput, type CompanionReadOnlyRequest } from '@greekgod/companion/readonly'
import type { AppData } from '../src/types.ts'
import { buildCompanionProductContext } from '../src/services/companionProductContext.ts'

test('product dialogue remains read-only even for mutation-like text', async () => {
  let modelRequest: CompanionReadOnlyRequest | undefined
  let mutations = 0
  const runtime = createReadOnlyCompanion({ readEvidence: async () => [] }, {
    propose: async (request) => { modelRequest = request; return { message: 'Zmiany wymagają osobnego polecenia.', evidenceIds: [] } },
  })
  const result = await runtime.dialogue(userDialogueInput('Zmień zakres na 10–15'))
  assert.equal(result.status, 'MESSAGE')
  assert.equal(modelRequest?.kind, 'COMPANION_READ_ONLY')
  assert.equal(modelRequest?.input.kind, 'USER_DIALOGUE')
  assert.equal(mutations, 0)
})

test('product context exposes only selected deterministic facts and friendly labels', async () => {
  const data = { version: 8, dailyEntries: [], workouts: [], templates: [], exerciseLibrary: [],
    settings: { language: 'pl', theme: 'dark', trendThresholds: { lossBelow: -0.1, stableUpper: 0.1, slowGainUpper: 0.3 } }, coachNotes: {} } as unknown as AppData
  let coachReads = 0, memoryReads = 0
  const sources = {
    readHumanCoach: async () => { coachReads++; return { version: 1 as const, items: [{
      id: 'internal-coach-id', kind: 'DECISION' as const, text: 'Technika ma pierwszeństwo.', exerciseIds: [],
      createdAt: '2026-09-01T10:00:00.000Z', provenance: { sourceType: 'MANUAL' as const, createdAt: '2026-09-01T10:00:00.000Z' },
      acceptance: { state: 'AUTHORITATIVE' as const, acceptedAt: '2026-09-01T10:01:00.000Z' },
    }] } },
    readMemory: async () => { memoryReads++; return { version: 1 as const, items: [{
      id: 'internal-memory-id', content: { kind: 'SUMMARY_STYLE' as const, value: 'SHORT' as const }, scope: { kind: 'GLOBAL' as const },
      expiresAt: null, source: 'USER_EXPLICIT' as const, createdAt: '2026-09-01T10:00:00.000Z',
      provenance: { acceptedBy: 'USER' as const, sourceId: null }, status: 'ACTIVE' as const,
    }] } },
  }
  const coach = await buildCompanionProductContext('Co ustaliliśmy z trenerem?', data, sources, '2026-09-17', '2026-09-17T10:00:00.000Z')
  assert.equal(coachReads, 1); assert.equal(memoryReads, 0); assert.equal(coach.evidence.length, 1)
  assert.equal(Object.values(coach.evidenceLabels)[0], 'Kontekst trenera 1')
  assert.doesNotMatch(coach.evidence[0].text, /internal-coach-id/)
  const memory = await buildCompanionProductContext('Jaką pamiętasz preferencję podsumowania?', data, sources, '2026-09-17', '2026-09-17T10:00:00.000Z')
  assert.equal(memoryReads, 1); assert.equal(memory.acceptedMemory.length, 1)
  assert.doesNotMatch(memory.evidence[0].text, /internal-memory-id/)
  const general = await buildCompanionProductContext('Cześć', data, sources, '2026-09-17', '2026-09-17T10:00:00.000Z')
  assert.deepEqual(general.evidence, [])
})

test('normal navigation uses managed product model and gates development surfaces', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/pages/Companion.tsx', import.meta.url), 'utf8')
  const command = readFileSync(new URL('../src/pages/ExplicitCommand.tsx', import.meta.url), 'utf8')
  const memory = readFileSync(new URL('../src/pages/CompanionMemory.tsx', import.meta.url), 'utf8')
  assert.match(app, /navigate\('companion'\)/)
  assert.match(app, /const CompanionMemory = import\.meta\.env\.DEV/)
  assert.match(app, /const CompanionReactions = import\.meta\.env\.DEV/)
  assert.match(app, /import\.meta\.env\.DEV[\s\S]*companion-memory[\s\S]*companion-reactions/)
  assert.match(page, /userDialogueInput\(question\)/)
  assert.match(page, /managedCompanionModel/)
  assert.match(page, /managedCompanionRuntime/)
  assert.doesNotMatch(page, /FakeCompanionModel|OllamaDevelopmentRuntime/)
  assert.doesNotMatch(page, /ActionDefinitionRegistry|TrackingCommandGateway|trackingCommands|changeTemplateRepRange/)
  assert.doesNotMatch(page, /companionMemoryRepository|humanCoachRepository|\.update\(|\.write\(/)
  assert.match(page, /onOpenCommand/)
  assert.match(command, /managedCompanionModel/)
  assert.doesNotMatch(command, /FakeCompanionModel|OllamaDevelopmentRuntime/)
  assert.match(command, /createExplicitCommandSession/)
  assert.match(command, /session\.prepare/)
  assert.match(command, /session\.execute\(session\.confirm\(result\)\)/)
  assert.match(memory, /service\.accept\(accepted\)/)
  assert.match(memory, /service\.reject\(candidate\)/)
})

test('AvatarPresenter alone maps closed semantic state and honors reduced motion', () => {
  const presenter = readFileSync(new URL('../src/components/AvatarPresenter.tsx', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/pages/Companion.tsx', import.meta.url), 'utf8')
  assert.match(presenter, /Record<SemanticReaction/)
  for (const state of ['NEUTRAL', 'ACKNOWLEDGE', 'POSITIVE', 'CONCERNED']) assert.match(presenter, new RegExp(state))
  assert.match(presenter, /state\.reducedMotion/)
  assert.doesNotMatch(presenter, /message|evidenceIds|asset|animation|timing|color/)
  assert.match(page, /<AvatarPresenter state=\{avatar\}/)
  assert.match(page, /prefers-reduced-motion/)
  assert.doesNotMatch(page, /presentation\.semanticReaction\s*===/)
})

test('unavailable AI state remains informational and exposes no process internals', () => {
  const page = readFileSync(new URL('../src/pages/Companion.tsx', import.meta.url), 'utf8')
  assert.match(page, /Lokalne AI jest opcjonalne/)
  assert.match(page, /Tracking działają bez niego/)
  assert.match(page, /onOpenSettings/)
  assert.doesNotMatch(page, /\bendpoint\b|\bruntimeVersion\b|\bassetRoot\b|\bPID\b|\bport\b|llama-server/)
})
