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

const rehearsalConfig = await readJson('src-tauri/tauri.rehearsal.conf.json')
const rehearsalEnvironment = await readFile(join(repositoryRoot, '.env.rehearsal'), 'utf8')
const [authoritySmokeConfig, authoritySmokeEnvironment] = await Promise.all([
  readJson('src-tauri/tauri.native-authority-smoke.conf.json'),
  readFile(join(repositoryRoot, '.env.authority-smoke'), 'utf8'),
])
const [authorityLiveSmokeConfig, authorityLiveSmokeEnvironment] = await Promise.all([
  readJson('src-tauri/tauri.native-authority-live-smoke.conf.json'),
  readFile(join(repositoryRoot, '.env.authority-live-smoke'), 'utf8'),
])
const nativeDesktopSource = await readFile(join(repositoryRoot, 'src-tauri/src/lib.rs'), 'utf8')
const schema8PhysicalSmokeLauncher = await readFile(join(repositoryRoot, 'scripts/start-schema8-physical-smoke.ps1'), 'utf8')
const [schema8PhysicalSmokeConfig, schema8PhysicalSmokeEnvironment] = await Promise.all([
  readJson('src-tauri/tauri.schema8-physical-smoke.conf.json'),
  readFile(join(repositoryRoot, '.env.schema8-physical-smoke'), 'utf8'),
])
const [productionAuthorityConfig, productionAuthorityEnvironment] = await Promise.all([
  readJson('src-tauri/tauri.production-authority.conf.json'),
  readFile(join(repositoryRoot, '.env.production-authority'), 'utf8'),
])

assert.equal(productionConfig.identifier, 'com.igorpich.formlog')
assert.equal(developmentConfig.identifier, 'com.igorpich.formlog.dev')
assert.equal(smokeConfig.identifier, 'com.igorpich.formlog.sqlitesmoke')
assert.equal(authoritySmokeConfig.identifier, 'com.igorpich.formlog.authoritysmoke')
assert.equal(authorityLiveSmokeConfig.identifier, 'com.igorpich.formlog.authoritylivesmoke')
assert.equal(schema8PhysicalSmokeConfig.identifier, 'com.igorpich.formlog.schema8smoke')
assert.equal(rehearsalConfig.identifier, 'com.igorpich.formlog.rehearsal')
assert.equal(productionAuthorityConfig.identifier, 'com.igorpich.formlog')
assert.equal(productionConfig.version, '3.0.2')
assert.equal(rehearsalConfig.version, '3.0.2')
assert.equal(productionAuthorityConfig.version, '3.0.2')
assert.equal(
  productionConfig.build.beforeBuildCommand,
  productionAuthorityConfig.build.beforeBuildCommand,
)
assert.notEqual(developmentConfig.identifier, productionConfig.identifier)
assert.notEqual(smokeConfig.identifier, productionConfig.identifier)
assert.notEqual(rehearsalConfig.identifier, productionConfig.identifier)
assert.notEqual(authoritySmokeConfig.identifier, productionConfig.identifier)
assert.notEqual(authorityLiveSmokeConfig.identifier, productionConfig.identifier)
assert.notEqual(schema8PhysicalSmokeConfig.identifier, productionConfig.identifier)
assert.match(packageJson.scripts['tauri:dev'], /--config src-tauri\/tauri\.dev\.conf\.json(?:\s|$)/)
assert.match(packageJson.scripts['tauri:dev'], /--features native-sqlite-authority/)
assert.match(packageJson.scripts['tauri:sqlite-smoke:build'], /--features native-sqlite-shadow/)
assert.match(packageJson.scripts['tauri:authority-smoke:build'], /--features native-sqlite-authority/)
assert.match(packageJson.scripts['tauri:authority-live-smoke:build'], /--features native-sqlite-authority/)
assert.match(packageJson.scripts['tauri:schema8-physical-smoke:build'], /--features native-sqlite-authority/)
assert.match(packageJson.scripts['tauri:schema8-physical-smoke:build'], /tauri\.schema8-physical-smoke\.conf\.json/)
assert.match(packageJson.scripts['tauri:rehearsal:build'], /--features native-sqlite-production-authority/)
assert.equal(packageJson.scripts['tauri:production-authority:build'], 'npm run tauri:build')
assert.doesNotMatch(packageJson.scripts['tauri:build'], /tauri\.dev\.conf\.json/)
assert.doesNotMatch(packageJson.scripts['tauri:build'], /native-sqlite-shadow/)
assert.match(packageJson.scripts['tauri:build'], /--features native-sqlite-production-authority/)
assert.equal(developmentEnvironment.trim(), 'VITE_NATIVE_SQLITE_AUTHORITY=1')
assert.equal(smokeEnvironment.trim(), 'VITE_NATIVE_SQLITE_SHADOW=1')
assert.equal(authoritySmokeEnvironment.trim(), 'VITE_NATIVE_SQLITE_AUTHORITY=1')
assert.equal(authorityLiveSmokeEnvironment.trim(), 'VITE_NATIVE_SQLITE_AUTHORITY=1')
assert.equal(schema8PhysicalSmokeEnvironment.trim(), 'VITE_NATIVE_SQLITE_AUTHORITY=1')
assert.match(nativeDesktopSource, /SCHEMA8_PHYSICAL_SMOKE_IDENTIFIER:\s*&str\s*=\s*"com\.igorpich\.formlog\.schema8smoke"/)
assert.match(nativeDesktopSource, /identifier\s*==\s*SCHEMA8_PHYSICAL_SMOKE_IDENTIFIER/)
assert.match(schema8PhysicalSmokeLauncher, /node --no-warnings --experimental-sqlite/)
assert.doesNotMatch(schema8PhysicalSmokeLauncher, /NODE_NO_WARNINGS/)
assert.match(schema8PhysicalSmokeLauncher, /'--pairing-window-seconds', '900'/)
assert.match(schema8PhysicalSmokeLauncher, /'--bind', \$bind/)
assert.match(schema8PhysicalSmokeLauncher, /\$pairing\.baseUrl -ne \$expectedBaseUrl/)
assert.equal(productionAuthorityEnvironment.trim(), 'VITE_NATIVE_SQLITE_PRODUCTION_AUTHORITY=1')
assert.equal(rehearsalEnvironment.trim(), 'VITE_NATIVE_SQLITE_PRODUCTION_AUTHORITY=1')

console.log('PASS development storage: production, dev and SQLite smoke compositions are isolated')
