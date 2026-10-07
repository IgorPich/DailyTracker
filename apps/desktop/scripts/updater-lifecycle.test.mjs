import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(resolve(desktopDirectory, path), 'utf8')
const config = JSON.parse(read('src-tauri/tauri.conf.json'))
const capability = JSON.parse(read('src-tauri/capabilities/default.json'))
const updateService = read('src/services/updateService.ts')
const updateContext = read('src/context/UpdateContext.tsx')
const closeLifecycle = read('src/services/closeLifecycle.ts')
const nativeRuntime = read('src-tauri/src/lib.rs')
const nsisTemplate = read('src-tauri/windows/installer.nsi')

assert.equal(config.bundle.windows.nsis.installMode, 'currentUser')
assert.match(nsisTemplate, /!if "\$\{INSTALLMODE\}" == "currentUser"\s+RequestExecutionLevel user/)
assert.equal(config.plugins.updater.windows.installMode, 'quiet')
assert.equal(config.plugins.updater.allowDowngrades, false)
assert.equal(config.bundle.createUpdaterArtifacts, true)
assert.match(config.plugins.updater.pubkey, /^[A-Za-z0-9+/]+={0,2}$/)
assert.ok(config.plugins.updater.pubkey.length > 100)
assert.deepEqual(config.plugins.updater.endpoints, [
  'https://github.com/IgorPich/DailyTracker/releases/latest/download/latest.json',
])
assert.ok(capability.permissions.includes('updater:default'))
assert.ok(capability.permissions.includes('core:window:allow-destroy'))
assert.match(updateService, /await update\.download\(/)
assert.doesNotMatch(updateService, /downloadAndInstall/)
assert.match(updateService, /appDataStore\.beginShutdown\(\)/)
assert.match(updateService, /destroyWindow: \(\) => window\.destroy\(\)/)
assert.match(updateService, /onCloseRequested/)
assert.match(closeLifecycle, /install\(\{ restartAfterInstall: false \}\)/)
assert.doesNotMatch(updateContext, /showToast|jest gotowy|announcedVersion/)
assert.doesNotMatch(nativeRuntime, /CloseRequested|app_handle\.exit/)

console.log('PASS updater lifecycle: current-user install, background download, verified staging and quiet close-boundary install')
