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
const installerTemplate = readFileSync(resolve(desktopDirectory, 'src-tauri', 'windows', 'installer.nsi'), 'utf8')
const polishInstaller = readFileSync(resolve(desktopDirectory, 'src-tauri', 'windows', 'Polish.nsh'), 'utf8')
const serviceMain = readFileSync(
  resolve(desktopDirectory, '..', 'sync-service', 'src', 'main.rs'),
  'utf8',
)
const postInstallHook = /!macro NSIS_HOOK_POSTINSTALL([\s\S]*?)!macroend/.exec(hooks)?.[1]
const preUninstallHook = /!macro NSIS_HOOK_PREUNINSTALL([\s\S]*?)!macroend/.exec(hooks)?.[1]

assert.deepEqual(config.bundle.targets, ['nsis'])
assert.equal(config.bundle.windows.nsis.template, 'windows/installer.nsi')
assert.deepEqual(config.bundle.windows.nsis.languages, ['Polish', 'English'])
assert.equal(config.bundle.windows.nsis.customLanguageFiles.Polish, 'windows/Polish.nsh')
assert.deepEqual(config.bundle.externalBin, ['binaries/greekgod-sync-service'])
assert.equal(
  config.bundle.resources['windows/sync-service-lifecycle.ps1'],
  'sync-service-lifecycle.ps1',
)
assert.equal(config.build.beforeBuildCommand, 'npm run build:bundle:production-authority')
assert.match(
  serviceMain,
  /cfg_attr\(all\(windows, not\(debug_assertions\)\), windows_subsystem = "windows"\)/,
)
assert.match(serviceMain, /DIAGNOSTIC_LOG_FILENAME: &str = "greekgod-sync-service\.log"/)

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
  "ClassName 'MSFT_TaskRepetitionPattern'",
  "Interval = 'PT1M'",
  "Duration = 'P1D'",
  '$triggers = @($logonTrigger, $watchdogTrigger)',
  '--bind-private-lan',
  '--version-json',
  '-RedirectStandardOutput $standardOutputPath',
  '-RedirectStandardError $standardErrorPath',
  '-WindowStyle Hidden',
  '-Wait',
]) {
  assert.ok(lifecycle.includes(required), `lifecycle is missing ${required}`)
}

assert.ok(!/Remove-Item[^\n]*(greekgod-v3\.sqlite|DatabasePath)/i.test(lifecycle))
assert.ok(!/Profile\s+(Public|Any|Domain)/i.test(lifecycle))
assert.ok(!/LocalPort\s+(Any|\*)/i.test(lifecycle))
assert.match(lifecycle, /'Install'\s*\{\s*Install-GreekGodSyncTask\s*Invoke-ElevatedFirewallAction 'InstallFirewall'/)
assert.match(lifecycle, /'InstallTask'\s*\{ Install-GreekGodSyncTask \}/)
assert.match(lifecycle, /'Uninstall'\s*\{\s*Uninstall-GreekGodSyncTask\s*Invoke-ElevatedFirewallAction 'RemoveFirewall'/)
assert.match(lifecycle, /-Verb RunAs/)

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
assert.ok(postInstallHook, 'post-install hook is missing')
assert.equal((postInstallHook.match(/\$UpdateMode = 1/g) ?? []).length, 2)
assert.equal((postInstallHook.match(/-Action InstallTask\b/g) ?? []).length, 2)
assert.equal((postInstallHook.match(/-Action Install\b/g) ?? []).length, 2)
assert.match(postInstallHook, /\$UpdateMode = 1[\s\S]*?-Action InstallTask[\s\S]*?\$\{Else\}[\s\S]*?-Action Install/)
assert.match(postInstallHook, /CopyFiles \/SILENT[\s\S]*?\$UpdateMode = 1[\s\S]*?-Action InstallTask[\s\S]*?\$\{Else\}[\s\S]*?-Action Install/)
assert.doesNotMatch(postInstallHook, /RunAs|InstallFirewall/)
assert.ok(preUninstallHook, 'pre-uninstall hook is missing')
assert.match(preUninstallHook, /-Action Uninstall\b/)

assert.match(installerTemplate, /\$\{If\} \$WixMode = 0\s+Abort\s+\$\{EndIf\}/)
assert.match(installerTemplate, /\$UpdateMode = 1/)
assert.match(installerTemplate, /MUI_FINISHPAGE_RUN/)
assert.doesNotMatch(installerTemplate, /MUI_FINISHPAGE_SHOWREADME/)
for (const key of [
  'addOrReinstall',
  'alreadyInstalledLong',
  'appRunning',
  'dontUninstall',
  'uninstallBeforeInstalling',
  'webview2Downloading',
  'deleteAppData',
]) {
  assert.match(polishInstaller, new RegExp(`LangString ${key} \\$\\{LANG_POLISH\\} "[^"]+"`))
}

console.log('PASS Windows Sync Service bundle/lifecycle policy')
