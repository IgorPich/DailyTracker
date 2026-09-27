import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generatedPath = resolve(desktopRoot, 'src-tauri', 'target', 'release', 'nsis', 'x64', 'installer.nsi')
const generated = readFileSync(generatedPath, 'utf8')
const hooks = readFileSync(resolve(desktopRoot, 'src-tauri', 'windows', 'hooks.nsh'), 'utf8')
const generatedEnglish = readFileSync(resolve(dirname(generatedPath), 'English.nsh'), 'utf8')
const generatedPolish = readFileSync(resolve(dirname(generatedPath), 'Polish.nsh'), 'utf8')

assert.doesNotMatch(generated, /\{\{[#/]?[^}]+\}\}/, 'generated NSIS still contains a template token')
assert.match(generated, /!define INSTALLMODE "currentUser"/)
assert.match(generated, /!define BUNDLEID "com\.igorpich\.formlog"/)
assert.match(generated, /Var DetectedNsisUpgrade/)
assert.match(generated, /StrCpy \$DetectedNsisUpgrade 1/)
assert.match(generated, /\$DetectedNsisUpgrade = 1[\s\S]*?StrCpy \$UpdateMode 1[\s\S]*?Goto reinst_done/)
assert.match(generated, /RmDir \/r "\$APPDATA\\\$\{BUNDLEID\}"/)
assert.match(generated, /\$DeleteAppDataCheckboxState = 1\s*\$\{AndIf\} \$UpdateMode <> 1/)
assert.match(generated, /!include ".*windows\\hooks\.nsh"/i)
assert.match(hooks, /NSIS_HOOK_PREINSTALL/)
assert.match(hooks, /-Action PrepareUpdate/)
assert.match(hooks, /-Action Install/)
assert.match(generated, /oname=vcruntime140\.dll/)
assert.doesNotMatch(generated, /\.gguf|llama-server(?:\.exe)?|ggml(?:-[^"\\]+)?\.dll/i)
assert.match(generated, /!include ".*\\Polish\.nsh"/i)
assert.match(generated, /!include ".*\\English\.nsh"/i)
assert.match(generatedPolish, /LangString upgradeExistingLong \$\{LANG_POLISH\}/)
assert.match(generatedEnglish, /LangString upgradeExistingLong \$\{LANG_ENGLISH\}/)

console.log(`PASS generated NSIS upgrade authority: ${generatedPath}`)
