import assert from 'node:assert/strict'
import test from 'node:test'
import { pairingPayloadJson, pairingSecondsRemaining, type PairingBootstrap } from '../src/services/phoneSyncService.ts'

const pairing: PairingBootstrap = {
  baseUrl: 'https://192.168.1.25:39173',
  serviceId: 'service-test',
  nonce: 'one-time-nonce',
  certificateFingerprintSha256: 'ab'.repeat(32),
  expiresAtEpoch: 1_700_000_120,
}

test('Desktop QR contains exactly the existing Mobile pairing bootstrap contract', () => {
  assert.deepEqual(JSON.parse(pairingPayloadJson(pairing)), pairing)
  assert.deepEqual(Object.keys(JSON.parse(pairingPayloadJson(pairing))), [
    'baseUrl',
    'serviceId',
    'nonce',
    'certificateFingerprintSha256',
    'expiresAtEpoch',
  ])
})

test('pairing expiry countdown is deterministic and never negative', () => {
  assert.equal(pairingSecondsRemaining(pairing, 1_700_000_000_000), 120)
  assert.equal(pairingSecondsRemaining(pairing, 1_700_000_121_000), 0)
})
