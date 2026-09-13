import assert from 'node:assert/strict'
import test from 'node:test'
import { trainingTimeSummary, type TrainingTimeSummaryQuery } from '../src/index.ts'

type Record = TrainingTimeSummaryQuery['snapshot']['workouts'][number]
const query = (workouts: readonly Record[]): TrainingTimeSummaryQuery => ({
  snapshot: { workouts }, from: '2024-02-10', to: '2024-03-07', asOf: '2024-04-01',
})
const record = (id: string, duration?: number, date = '2024-02-15'): Record => ({ id, date, duration })

test('arbitrary inclusive interval, recorded denominator, measured sum and average only', () => {
  const result = trainingTimeSummary(query([
    record('before', 100, '2024-02-09'), record('first', 65, '2024-02-10'),
    record('missing'), record('last', 35, '2024-03-07'), record('after', 100, '2024-03-08'),
  ]))
  assert.equal(result.recordedWorkoutCount, 3)
  assert.equal(result.workoutsWithDuration, 2)
  assert.equal(result.workoutsWithoutDuration, 1)
  assert.equal(result.totalDurationMinutes, 100)
  assert.equal(result.averageDurationMinutes, 50)
  assert.deepEqual(result.coverage, { numerator: 2, denominator: 3 })
  assert.deepEqual(result.evidenceWorkoutIds, ['first', 'last'])
  assert.equal('completedWorkoutCount' in result, false)
})

for (const [label, value] of [
  ['missing', undefined], ['zero', 0], ['negative', -4], ['NaN', NaN],
  ['positive infinity', Infinity], ['negative infinity', -Infinity],
  ['string', '30'], ['null', null],
] as const) {
  test(`${label} duration is unavailable, not a zero-duration measurement`, () => {
    const result = trainingTimeSummary(query([record('unavailable', value as number | undefined), record('usable', 12.5)]))
    assert.equal(result.recordedWorkoutCount, 2)
    assert.equal(result.workoutsWithoutDuration, 1)
    assert.equal(result.totalDurationMinutes, 12.5)
    assert.equal(result.averageDurationMinutes, 12.5)
    assert.deepEqual(result.coverage, { numerator: 1, denominator: 2 })
  })
}

test('no usable durations gives zero total, no average, and honest coverage', () => {
  const result = trainingTimeSummary(query([record('missing'), record('invalid', 0)]))
  assert.equal(result.totalDurationMinutes, 0)
  assert.equal('averageDurationMinutes' in result, false)
  assert.deepEqual(result.coverage, { numerator: 0, denominator: 2 })
})

test('no records in range', () => {
  const result = trainingTimeSummary(query([record('outside', 20, '2023-01-01')]))
  assert.equal(result.recordedWorkoutCount, 0)
  assert.equal(result.workoutsWithoutDuration, 0)
  assert.equal(result.totalDurationMinutes, 0)
  assert.equal(result.averageDurationMinutes, undefined)
  assert.deepEqual(result.coverage, { numerator: 0, denominator: 0 })
})

test('wide all-time-style range and single-day range', () => {
  const input = query([record('old', 10895, '2001-01-01'), record('new', 65, '2024-03-07')])
  assert.equal(trainingTimeSummary({ ...input, from: '1900-01-01' }).totalDurationMinutes, 10960)
  assert.equal(trainingTimeSummary({ ...input, from: input.to }).recordedWorkoutCount, 1)
})

test('deterministic order, no mutation, unrelated fields and records do not affect summary', () => {
  const records = Object.freeze([Object.freeze(record('b', 25)), Object.freeze(record('a', 10))])
  const expected = trainingTimeSummary(query(records))
  assert.deepEqual(trainingTimeSummary(query([...records].reverse())), expected)
  assert.deepEqual(trainingTimeSummary(query(records)), expected)
  assert.deepEqual(trainingTimeSummary(query(records.map((item) => ({ ...item, exercises: [], templateId: 'unrelated', note: 'anything' })))), expected)
  assert.deepEqual(trainingTimeSummary(query([...records, record('outside', 999, '2025-01-01')])), expected)
  assert.deepEqual(records.map((item) => item.id), ['b', 'a'])
})

test('invalid calendar dates excluded; query errors reject rather than silently alter the interval', () => {
  assert.equal(trainingTimeSummary(query([record('bad', 10, '2024-02-30')])).recordedWorkoutCount, 0)
  for (const override of [{ from: '2024-02-30' }, { from: '2024-3-01' }, { from: '2024-04-01' }, { to: '2024-04-02' }, { asOf: 'bad' }]) {
    assert.throws(() => trainingTimeSummary({ ...query([]), ...override }), RangeError)
  }
})

test('numeric overflow fails explicitly', () => {
  assert.throws(() => trainingTimeSummary(query([record('a', Number.MAX_VALUE), record('b', Number.MAX_VALUE)])), RangeError)
})
