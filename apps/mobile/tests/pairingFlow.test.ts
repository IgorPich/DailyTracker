import assert from 'node:assert/strict'
import test from 'node:test'
import { pairingPanelVisible, validatePairingCode } from '../src/services/pairingFlow.ts'

const bootstrap = {
  baseUrl: 'https://192.168.1.25:39173',
  serviceId: 'pc-service',
  nonce: 'one-time-nonce',
  certificateFingerprintSha256: 'ab'.repeat(32),
  expiresAtEpoch: 1_700_000_120,
}

test('paired state keeps pairing hidden until the user explicitly requests replacement', () => {
  assert.equal(pairingPanelVisible(true, false), false)
  assert.equal(pairingPanelVisible(true, true), true)
  assert.equal(pairingPanelVisible(false, false), true)
})

test('replacement bootstrap accepts the exact Desktop contract while still valid', () => {
  assert.deepEqual(validatePairingCode(JSON.stringify(bootstrap), 1_700_000_000), bootstrap)
})

test('replacement bootstrap fails closed when expired or structurally invalid', () => {
  assert.throws(
    () => validatePairingCode(JSON.stringify(bootstrap), bootstrap.expiresAtEpoch),
    /wygasł/,
  )
  assert.throws(
    () => validatePairingCode(JSON.stringify({ ...bootstrap, baseUrl: 'http://pc' }), 1_700_000_000),
    /Nieprawidłowy/,
  )
  assert.throws(
    () => validatePairingCode(JSON.stringify({ ...bootstrap, expiresAtEpoch: undefined }), 1_700_000_000),
    /Nieprawidłowy/,
  )
})
