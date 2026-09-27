import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(desktopRoot, '..', '..')
const tauriRoot = resolve(desktopRoot, 'src-tauri')
const config = JSON.parse(readFileSync(resolve(tauriRoot, 'tauri.conf.json'), 'utf8'))
const template = readFileSync(resolve(tauriRoot, 'windows', 'installer.nsi'), 'utf8')
const english = readFileSync(resolve(tauriRoot, 'windows', 'languages', 'English.nsh'), 'utf8')
const polish = readFileSync(resolve(tauriRoot, 'windows', 'languages', 'Polish.nsh'), 'utf8')
const hooks = readFileSync(resolve(tauriRoot, 'windows', 'hooks.nsh'), 'utf8')
const packageLock = JSON.parse(readFileSync(resolve(repositoryRoot, 'package-lock.json'), 'utf8'))
const cargoLock = readFileSync(resolve(tauriRoot, 'Cargo.lock'), 'utf8')

assert.equal(packageLock.packages['node_modules/@tauri-apps/cli'].version, '2.11.4')
assert.match(cargoLock, /name = "tauri"\r?\nversion = "2\.11\.5"/)
assert.equal(config.bundle.windows.nsis.installMode, 'currentUser')
assert.equal(config.identifier, 'com.igorpich.formlog')
assert.equal(config.bundle.windows.nsis.template, 'windows/installer.nsi')
assert.deepEqual(config.bundle.windows.nsis.languages, ['Polish', 'English'])
assert.deepEqual(config.bundle.windows.nsis.customLanguageFiles, {
  Polish: 'windows/languages/Polish.nsh',
  English: 'windows/languages/English.nsh',
})

assert.match(template, /official Tauri CLI 2\.11\.4 NSIS template/)
assert.match(template, /Var DetectedNsisUpgrade/)
assert.match(template, /StrCpy \$DetectedNsisUpgrade 1/)
assert.match(template, /StrCpy \$R1 "\$\(upgradeExistingLong\)"/)
assert.match(template, /MUI_HEADER_TEXT "\$\(upgradeExisting\)" "\$\(upgradeReady\)"/)

const pageLeave = template.slice(
  template.indexOf('Function PageLeaveReinstall'),
  template.indexOf('; 5. Choose install directory page'),
)
const wixGuard = pageLeave.indexOf('${If} $WixMode = 1')
const upgradeGuard = pageLeave.indexOf('${If} $DetectedNsisUpgrade = 1')
const updateSelection = pageLeave.indexOf('StrCpy $UpdateMode 1', upgradeGuard)
const updateDone = pageLeave.indexOf('Goto reinst_done', updateSelection)
const radioRead = pageLeave.indexOf('${NSD_GetState} $R2 $R1')
assert.ok(wixGuard >= 0 && wixGuard < upgradeGuard, 'WiX migration must retain uninstall behavior')
assert.ok(upgradeGuard < updateSelection && updateSelection < updateDone,
  'an older NSIS installation must select Tauri in-place update mode')
assert.ok(updateDone < radioRead,
  'the deterministic upgrade path must not depend on uninstall-choice radio controls')
assert.ok(updateDone < pageLeave.indexOf('reinst_uninstall:'),
  'the deterministic upgrade path must exit before any previous-uninstaller invocation')

const upgradePage = template.indexOf('Page custom PageReinstall PageLeaveReinstall')
const installSection = template.indexOf('Section Install')
const preinstallHook = template.indexOf('!insertmacro NSIS_HOOK_PREINSTALL', installSection)
assert.ok(upgradePage >= 0 && upgradePage < installSection && installSection < preinstallHook,
  'cancelling at the detected-upgrade page must happen before hooks or file replacement')

const uninstallSection = template.slice(
  template.indexOf('Section Uninstall'),
  template.indexOf('Function RestorePreviousInstallLocation'),
)
const dataOptIn = uninstallSection.indexOf('${If} $DeleteAppDataCheckboxState = 1')
const notUpdating = uninstallSection.indexOf('${AndIf} $UpdateMode <> 1', dataOptIn)
const roamingDelete = uninstallSection.indexOf('RmDir /r "$APPDATA\\${BUNDLEID}"', notUpdating)
const localDelete = uninstallSection.indexOf('RmDir /r "$LOCALAPPDATA\\${BUNDLEID}"', roamingDelete)
assert.ok(dataOptIn >= 0 && dataOptIn < notUpdating && notUpdating < roamingDelete && roamingDelete < localDelete,
  'AppData deletion must remain opt-in and impossible in update mode')

for (const required of [
  'NSIS_HOOK_PREINSTALL',
  '-Action PrepareUpdate',
  'NSIS_HOOK_POSTINSTALL',
  '-Action Install',
  'greekgod-sync-service.previous.exe',
  'greekgod_sync_install_failed:',
  'Abort "Nie udało się bezpiecznie uruchomić GreekGod Sync Service.',
]) {
  assert.ok(hooks.includes(required), `installer hooks are missing ${required}`)
}

assert.equal(
  config.bundle.resources['binaries/windows-native-runtime/vcruntime140.dll'],
  'vcruntime140.dll',
)
assert.deepEqual(config.bundle.externalBin, ['binaries/greekgod-sync-service'])
assert.equal(
  Object.keys(config.bundle.resources).some((path) => /\.gguf$|llama-server|ggml/i.test(path)),
  false,
  'the base installer must not contain Offline AI Pack assets',
)

for (const language of [english, polish]) {
  assert.match(language, /LangString upgradeExisting /)
  assert.match(language, /LangString upgradeReady /)
  assert.match(language, /LangString upgradeExistingLong /)
  assert.match(language, /manual uninstall is not required|ręczne odinstalowanie nie jest potrzebne/)
}

console.log('PASS deterministic current-user NSIS in-place upgrade policy')
