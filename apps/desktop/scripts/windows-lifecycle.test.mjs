import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(resolve(desktopDirectory, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const lifecycle = readFileSync(
  resolve(desktopDirectory, 'src-tauri', 'windows', 'sync-service-lifecycle.ps1'),
  'utf8',
)
const hooks = readFileSync(resolve(desktopDirectory, 'src-tauri', 'windows', 'hooks.nsh'), 'utf8')

assert.deepEqual(config.bundle.targets, ['nsis'])
assert.deepEqual(config.bundle.externalBin, ['binaries/greekgod-sync-service'])
assert.equal(
  config.bundle.resources['windows/sync-service-lifecycle.ps1'],
  'sync-service-lifecycle.ps1',
)
assert.equal(config.build.beforeBuildCommand, 'npm run build:bundle:production-authority')

for (const required of [
  '-Profile Private',
  '-RemoteAddress LocalSubnet',
  '-Protocol TCP',
  '-LocalPort $Port',
  '-Protocol UDP',
  '-LocalPort 5353',
  '-Program $ServiceExecutable',
  '-RestartCount 10',
  '-MultipleInstances IgnoreNew',
  '--bind-private-lan',
  '--version-json',
]) {
  assert.ok(lifecycle.includes(required), `lifecycle is missing ${required}`)
}

assert.ok(!/Remove-Item[^\n]*(greekgod-v3\.sqlite|DatabasePath)/i.test(lifecycle))
assert.ok(!/Profile\s+(Public|Any|Domain)/i.test(lifecycle))
assert.ok(!/LocalPort\s+(Any|\*)/i.test(lifecycle))

for (const required of [
  'NSIS_HOOK_PREINSTALL',
  '-Action PrepareUpdate',
  'greekgod-sync-service.previous.exe',
  'NSIS_HOOK_POSTINSTALL',
  '-Action Install',
  'NSIS_HOOK_PREUNINSTALL',
  '-Action Uninstall',
]) {
  assert.ok(hooks.includes(required), `NSIS hooks are missing ${required}`)
}

assert.ok(!hooks.includes('Remove-Item'))
assert.ok(!hooks.includes('greekgod-v3.sqlite" /'))

console.log('PASS Windows Sync Service bundle/lifecycle policy')
