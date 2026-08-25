import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = async (relativePath) => JSON.parse(
  await readFile(join(repositoryRoot, relativePath), 'utf8'),
)

const [packageJson, productionConfig, developmentConfig] = await Promise.all([
  readJson('package.json'),
  readJson('src-tauri/tauri.conf.json'),
  readJson('src-tauri/tauri.dev.conf.json'),
])

assert.equal(productionConfig.identifier, 'com.igorpich.formlog')
assert.equal(developmentConfig.identifier, 'com.igorpich.formlog.dev')
assert.notEqual(developmentConfig.identifier, productionConfig.identifier)
assert.match(packageJson.scripts['tauri:dev'], /--config src-tauri\/tauri\.dev\.conf\.json(?:\s|$)/)
assert.doesNotMatch(packageJson.scripts['tauri:build'], /tauri\.dev\.conf\.json/)

console.log('PASS development storage: Tauri dev and production identifiers are isolated')
