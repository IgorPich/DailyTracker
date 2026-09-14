import assert from 'node:assert/strict'
import test from 'node:test'
import { upsertDailyEntry, type DailyEntry } from '@greekgod/core'
import { applyJournalNumericDraft, journalDraft, journalNumericDraft } from '../src/domain/mobileModel.ts'

// Characterization only. These additive fields are synthetic wire payloads, not a new domain contract.
type FutureEntry = DailyEntry & { measurements?: Record<string, number> }
const original: FutureEntry = { id: 'synthetic-day', date: '2026-01-15', weight: 80 }

test('preflight: already loaded unknown measurements survive an ordinary Mobile edit', () => {
  const loaded: FutureEntry = { ...original, measurements: { CHEST: 100, BICEPS: 35 } }
  const draft = journalDraft(loaded, loaded.date)
  const numbers = { ...journalNumericDraft(loaded), weight: '81,5' }
  const edited = applyJournalNumericDraft(draft, numbers) as FutureEntry
  assert.deepEqual(edited.measurements, loaded.measurements)
  assert.equal(edited.weight, 81.5)
})

test('STOP evidence: retry on fresh authority replaces newer unknown measurements with stale draft', () => {
  const draft = journalDraft(original, original.date)
  const entry = applyJournalNumericDraft(draft, { ...journalNumericDraft(original), weight: '81' })
  const fresh: FutureEntry = { ...original, measurements: { CHEST: 100, BICEPS: 35 } }
  // JournalPage captures entry outside updater; MobileDataContext replays this updater after CAS refresh.
  const retried = upsertDailyEntry([fresh], entry) as FutureEntry[]
  assert.equal(retried.length, 1)
  assert.equal(retried[0].weight, 81)
  assert.equal(retried[0].measurements, undefined, 'characterizes forbidden loss; NOT desired future behavior')
  assert.deepEqual(fresh.measurements, { CHEST: 100, BICEPS: 35 })
})

test('STOP evidence: stale draft can resurrect an older generic measurement value', () => {
  const loaded: FutureEntry = { ...original, measurements: { CHEST: 99 } }
  const entry = applyJournalNumericDraft(journalDraft(loaded, loaded.date), journalNumericDraft(loaded))
  const fresh: FutureEntry = { ...original, measurements: { CHEST: 101, BICEPS: 35 } }
  const retried = upsertDailyEntry([fresh], entry) as FutureEntry[]
  assert.deepEqual(retried[0].measurements, { CHEST: 99 }, 'characterization: newer value and new key are lost')
})
