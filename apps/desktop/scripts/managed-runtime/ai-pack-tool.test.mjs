import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { contractFiles, validateContract, verifyPack } from './ai-pack-tool.mjs'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const data = new Map([
  ['model/test.gguf', Buffer.from('qualified model')],
  ['runtime/server.exe', Buffer.from('runtime')],
  ['legal/license.txt', Buffer.from('license')],
  ['provenance/source.json', Buffer.from('{}')],
])
const contract = () => ({
  manifestFormatVersion: 1, packId: 'test', packVersion: '4.0.0',
  greekGodCompatibility: { product: 'GreekGod', releaseLine: '4.0', platform: 'windows-x86_64' },
  model: { identity: 'test', sourceRepository: 'test', sourceRevision: 'test', relativePath: 'model/test.gguf', bytes: data.get('model/test.gguf').length, sha256: sha(data.get('model/test.gguf')), quantization: 'Q4_0' },
  runtime: { build: 'b10760', commit: 'test', relativePath: 'runtime', files: [{ relativePath: 'server.exe', bytes: data.get('runtime/server.exe').length, sha256: sha(data.get('runtime/server.exe')) }] },
  requiredFiles: [
    { kind: 'LEGAL', relativePath: 'legal/license.txt', bytes: data.get('legal/license.txt').length, sha256: sha(data.get('legal/license.txt')) },
    { kind: 'PROVENANCE', relativePath: 'provenance/source.json', bytes: data.get('provenance/source.json').length, sha256: sha(data.get('provenance/source.json')) },
  ],
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'greekgod-ai-pack-test-'))
  const manifest = contract()
  for (const [path, bytes] of data) { const target = join(root, ...path.split('/')); await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, bytes) }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
  return { root, manifest, close: () => rm(root, { recursive: true, force: true }) }
}

test('standalone verifier accepts a complete exact pack', async () => {
  const item = await fixture(); try { assert.equal((await verifyPack(item.root, item.manifest)).files.length, 4) } finally { await item.close() }
})

for (const [name, mutate, pattern] of [
  ['model missing', async (root) => unlink(join(root, 'model/test.gguf')), /MODEL_MISSING/],
  ['model wrong size', async (root) => writeFile(join(root, 'model/test.gguf'), 'x'), /MODEL_INVALID_SIZE/],
  ['model wrong hash', async (root) => writeFile(join(root, 'model/test.gguf'), 'qualified modeL'), /MODEL_INVALID_HASH/],
  ['runtime missing', async (root) => unlink(join(root, 'runtime/server.exe')), /RUNTIME_MISSING/],
  ['runtime wrong hash', async (root) => writeFile(join(root, 'runtime/server.exe'), 'Runtime'), /RUNTIME_INVALID_HASH/],
  ['unexpected runtime executable', async (root) => writeFile(join(root, 'runtime/evil.exe'), 'evil'), /UNEXPECTED_FILE/],
]) test(`standalone verifier rejects ${name}`, async () => {
  const item = await fixture(); try { await mutate(item.root); await assert.rejects(verifyPack(item.root, item.manifest), pattern) } finally { await item.close() }
})

test('manifest parser rejects malformed and unsupported manifests', async () => {
  const item = await fixture(); try {
    await writeFile(join(item.root, 'manifest.json'), '{')
    await assert.rejects(verifyPack(item.root, item.manifest), /MANIFEST_INVALID/)
    const unsupported = { ...item.manifest, manifestFormatVersion: 2 }
    await writeFile(join(item.root, 'manifest.json'), JSON.stringify(unsupported))
    await assert.rejects(verifyPack(item.root, item.manifest), /UNSUPPORTED_MANIFEST_VERSION/)
  } finally { await item.close() }
})

test('contract rejects traversal and duplicate/case-ambiguous paths', () => {
  const traversal = contract(); traversal.model.relativePath = '../test.gguf'
  assert.throws(() => contractFiles(traversal), /UNSAFE_PATH/)
  const duplicate = contract(); duplicate.requiredFiles.push({ ...duplicate.requiredFiles[0], relativePath: 'LEGAL/license.txt' })
  assert.throws(() => contractFiles(duplicate), /DUPLICATE_PATH/)
})

test('tooling and production integration contain no acquisition or network fallback', async () => {
  const tool = await readFile(new URL('./ai-pack-tool.mjs', import.meta.url), 'utf8')
  const integration = await readFile(new URL('../../src/services/offlineAiPack.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(tool + integration, /\bfetch\s*\(|https?:\/\/|Ollama|11434/)
  assert.throws(() => validateContract({ ...contract(), manifestFormatVersion: 2 }, contract()), /UNSUPPORTED_MANIFEST_VERSION/)
})
