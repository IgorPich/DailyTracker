import { deepStrictEqual, equal, notStrictEqual, strictEqual } from 'node:assert/strict'
import test from 'node:test'
import { deleteDailyEntry, findDailyEntryByDate, upsertDailyEntry } from '../src/dailyEntryOperations.ts'
import { dailyEntryFixture as entry } from './fixtures/dailyEntry.fixture.ts'

test('adds a new day at the end without sorting existing entries', () => {
  const entries = [
    entry('entry-25', '2026-08-25', { protein: 170 }),
    entry('entry-23', '2026-08-23', { protein: 160 }),
  ]
  const incoming = entry('entry-24', '2026-08-24', { protein: 180 })

  const result = upsertDailyEntry(entries, incoming)

  deepStrictEqual(result.map((item) => item.id), ['entry-25', 'entry-23', 'entry-24'])
  equal(result.length, entries.length + 1)
})

test('replaces an occupied date with the incoming entry and id', () => {
  const entries = [
    entry('entry-23', '2026-08-23'),
    entry('entry-old-24', '2026-08-24', { protein: 170 }),
    entry('entry-25', '2026-08-25'),
  ]
  const incoming = entry('entry-new-24', '2026-08-24', { protein: 195 })

  const result = upsertDailyEntry(entries, incoming)

  deepStrictEqual(result.map((item) => item.id), ['entry-23', 'entry-25', 'entry-new-24'])
  equal(result.filter((item) => item.date === incoming.date).length, 1)
  equal(result.at(-1)?.protein, 195)
})

test('updates an existing id without creating a duplicate and moves it to the end', () => {
  const entries = [
    entry('entry-23', '2026-08-23'),
    entry('entry-24', '2026-08-24', { protein: 170 }),
    entry('entry-25', '2026-08-25'),
  ]
  const incoming = entry('entry-24', '2026-08-24', { protein: 195, note: 'Updated snapshot' })

  const result = upsertDailyEntry(entries, incoming)

  deepStrictEqual(result.map((item) => item.id), ['entry-23', 'entry-25', 'entry-24'])
  equal(result.filter((item) => item.id === incoming.id).length, 1)
  deepStrictEqual(result.at(-1), incoming)
})

test('collapses every existing duplicate of the incoming date', () => {
  const entries = [
    entry('entry-23', '2026-08-23'),
    entry('entry-24-a', '2026-08-24'),
    entry('entry-24-b', '2026-08-24'),
    entry('entry-25', '2026-08-25'),
  ]
  const incoming = entry('entry-24-final', '2026-08-24')

  const result = upsertDailyEntry(entries, incoming)

  deepStrictEqual(result.map((item) => item.id), ['entry-23', 'entry-25', 'entry-24-final'])
  equal(result.filter((item) => item.date === incoming.date).length, 1)
})

test('preserves every non-conflicting day and its relative order', () => {
  const first = entry('entry-first', '2026-08-21', { note: 'First untouched day' })
  const replaced = entry('entry-replaced', '2026-08-22')
  const second = entry('entry-second', '2026-08-20', { note: 'Second untouched day' })
  const incoming = entry('entry-incoming', '2026-08-22')

  const result = upsertDailyEntry([first, replaced, second], incoming)

  deepStrictEqual(result, [first, second, incoming])
})

test('preserves every DailyEntry field without normalization', () => {
  const completeEntry = entry('entry-complete', '2026-08-26', {
    weight: 0,
    calories: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
    steps: 0,
    waist: 0,
    sleep: 0,
    recovery: 0,
    note: '  Synthetic note stays untouched  ',
  })

  const result = upsertDailyEntry([], completeEntry)

  deepStrictEqual(result[0], completeEntry)
  strictEqual(result[0], completeEntry)
})

test('removes separate id and date collisions exactly like the existing application', () => {
  const idCollision = entry('shared-id', '2026-08-23')
  const dateCollision = entry('different-id', '2026-08-24')
  const untouched = entry('untouched-id', '2026-08-25')
  const incoming = entry('shared-id', '2026-08-24', { protein: 195 })

  const result = upsertDailyEntry([idCollision, dateCollision, untouched], incoming)

  deepStrictEqual(result, [untouched, incoming])
})

test('does not mutate the input array or its entries', () => {
  const entries = [
    entry('entry-23', '2026-08-23', { protein: 160 }),
    entry('entry-24', '2026-08-24', { protein: 170 }),
  ]
  const snapshot = structuredClone(entries)

  const result = upsertDailyEntry(entries, entry('entry-24', '2026-08-24', { protein: 195 }))

  deepStrictEqual(entries, snapshot)
  notStrictEqual(result, entries)
})

test('deletes every DailyEntry with the exact id and preserves remaining order', () => {
  const first = entry('duplicate-id', '2026-08-21')
  const untouched = entry('untouched-id', '2026-08-22')
  const duplicate = entry('duplicate-id', '2026-08-23')
  const entries = [first, untouched, duplicate]

  const result = deleteDailyEntry(entries, 'duplicate-id')

  deepStrictEqual(result, [untouched])
  deepStrictEqual(entries, [first, untouched, duplicate])
  notStrictEqual(result, entries)
})

test('DailyEntry delete returns a new list when the id is missing', () => {
  const entries = [entry('entry-a', '2026-08-21')]

  const result = deleteDailyEntry(entries, 'missing-id')

  deepStrictEqual(result, entries)
  notStrictEqual(result, entries)
})

test('DailyEntry lookup returns the first exact date match', () => {
  const first = entry('first-id', '2026-08-21')
  const duplicateDate = entry('second-id', '2026-08-21')

  strictEqual(findDailyEntryByDate([first, duplicateDate], '2026-08-21'), first)
  strictEqual(findDailyEntryByDate([first], '2026-08-22'), undefined)
})
