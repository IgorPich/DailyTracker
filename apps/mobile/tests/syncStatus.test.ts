import assert from 'node:assert/strict'
import test from 'node:test'
import { syncLabelForTransmittable } from '../src/services/syncStatus.ts'

test('quarantined review rows do not make the primary status wait', () => {
  assert.equal(syncLabelForTransmittable(0), 'Synced')
})

test('an eligible outbox operation makes the primary status wait', () => {
  assert.equal(syncLabelForTransmittable(1), 'Changes waiting')
})
