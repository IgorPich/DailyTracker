import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { contract, verifyRuntimeDirectory } from './prepare-windows-native-runtime.mjs'

test('native runtime contract is exact, x64 and sourced from the official toolchain redist', () => {
  assert.equal(contract.formatVersion, 1)
  assert.equal(contract.platform, 'windows-x86_64')
  assert.equal(contract.policy, 'APP_LOCAL_PINNED_VC_RUNTIME')
  assert.equal(contract.source.product, 'Microsoft Visual Studio Build Tools 2022')
  assert.match(contract.source.redistributionReference, /^https:\/\/learn\.microsoft\.com\//)
  assert.deepEqual(contract.baseFiles, ['vcruntime140.dll'])
  assert.deepEqual(contract.aiPackFiles, ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'])
  assert.equal(new Set(contract.files.map((file) => file.name.toLowerCase())).size, contract.files.length)
  for (const file of contract.files) {
    assert.equal(file.architecture, 'x64')
    assert.equal(file.fileVersion, contract.source.fileVersion)
    assert.match(file.sha256, /^[a-f0-9]{64}$/)
  }
})

test('runtime verifier rejects missing, altered and arbitrary substitutions without acquisition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'greekgod-vc-policy-test-'))
  try {
    await assert.rejects(verifyRuntimeDirectory(root, contract.baseFiles), /NATIVE_PREREQUISITE_MISSING_OR_INVALID/)
    const expected = contract.files.find((file) => file.name === contract.baseFiles[0])
    await writeFile(join(root, expected.name), Buffer.alloc(expected.bytes))
    await assert.rejects(verifyRuntimeDirectory(root, contract.baseFiles), /NATIVE_PREREQUISITE_HASH_MISMATCH/)
    await mkdir(join(root, 'unapproved'), { recursive: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
  const source = await readFile(new URL('./prepare-windows-native-runtime.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\bfetch\s*\(|Invoke-WebRequest|curl|System32/i)
})
