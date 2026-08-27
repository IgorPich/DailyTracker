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
const [smokeConfig, developmentEnvironment, smokeEnvironment] = await Promise.all([
  readJson('src-tauri/tauri.native-sqlite-smoke.conf.json'),
  readFile(join(repositoryRoot, '.env.development'), 'utf8'),
  readFile(join(repositoryRoot, '.env.sqlite-smoke'), 'utf8'),
])
const [authoritySmokeConfig, authoritySmokeEnvironment] = await Promise.all([
  readJson('src-tauri/tauri.native-authority-smoke.conf.json'),
  readFile(join(repositoryRoot, '.env.authority-smoke'), 'utf8'),
])

assert.equal(productionConfig.identifier, 'com.igorpich.formlog')
assert.equal(developmentConfig.identifier, 'com.igorpich.formlog.dev')
assert.equal(smokeConfig.identifier, 'com.igorpich.formlog.sqlitesmoke')
assert.equal(authoritySmokeConfig.identifier, 'com.igorpich.formlog.authoritysmoke')
assert.notEqual(developmentConfig.identifier, productionConfig.identifier)
assert.notEqual(smokeConfig.identifier, productionConfig.identifier)
assert.notEqual(authoritySmokeConfig.identifier, productionConfig.identifier)
assert.match(packageJson.scripts['tauri:dev'], /--config src-tauri\/tauri\.dev\.conf\.json(?:\s|$)/)
assert.match(packageJson.scripts['tauri:dev'], /--features native-sqlite-authority/)
assert.match(packageJson.scripts['tauri:sqlite-smoke:build'], /--features native-sqlite-shadow/)
assert.match(packageJson.scripts['tauri:authority-smoke:build'], /--features native-sqlite-authority/)
assert.doesNotMatch(packageJson.scripts['tauri:build'], /tauri\.dev\.conf\.json/)
assert.doesNotMatch(packageJson.scripts['tauri:build'], /native-sqlite-shadow/)
assert.doesNotMatch(packageJson.scripts['tauri:build'], /native-sqlite-authority/)
assert.equal(developmentEnvironment.trim(), 'VITE_NATIVE_SQLITE_AUTHORITY=1')
assert.equal(smokeEnvironment.trim(), 'VITE_NATIVE_SQLITE_SHADOW=1')
assert.equal(authoritySmokeEnvironment.trim(), 'VITE_NATIVE_SQLITE_AUTHORITY=1')

console.log('PASS development storage: production, dev and SQLite smoke compositions are isolated')
