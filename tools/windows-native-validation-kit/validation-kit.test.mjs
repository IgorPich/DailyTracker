import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const repository = resolve(root, '..', '..')
const scriptsRoot = join(root, 'scripts')
const contract = JSON.parse(await readFile(join(root, 'validation-kit-contract.json'), 'utf8'))
const aiContract = JSON.parse(await readFile(join(repository, 'apps/desktop/src-tauri/ai-pack/greekgod-ai-pack-4.0.json'), 'utf8'))
const nativeContract = JSON.parse(await readFile(join(repository, 'apps/desktop/src-tauri/windows-native-runtime/greekgod-windows-native-runtime.json'), 'utf8'))
const names = (await readdir(scriptsRoot)).filter((name) => name.endsWith('.ps1')).sort()

assert.deepEqual(names, [
  'Collect-Evidence.ps1', 'Invoke-Preflight.ps1', 'NativeValidation.Common.ps1',
  'Record-ManualResult.ps1', 'Self-Test.ps1', 'Test-AiPack.ps1',
  'Verify-LlamaModules.ps1', 'Verify-NoOrphan.ps1', 'Verify-SyncServiceModule.ps1',
])
assert.equal(contract.installer.sha256, '3d2b5f56338820a3789b8e09f813e6285f2b6c982b5961654a23770d2575ca88')
assert.equal(contract.aiPack.trustedPayloadFiles, 33)
assert.equal(contract.aiPack.modelSha256, aiContract.model.sha256)
assert.equal(contract.aiPack.windowsNativeRuntimeSet, aiContract.windowsNativeRuntimeSet)
assert.equal(contract.aiPack.windowsNativeRuntimeSet, nativeContract.contractId)

const sources = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(join(scriptsRoot, name), 'utf8')])))
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `Get-ChildItem -LiteralPath '${scriptsRoot.replaceAll("'", "''")}' -Filter *.ps1 | ForEach-Object { [void][scriptblock]::Create((Get-Content -LiteralPath $_.FullName -Raw)) }`], { stdio: 'pipe' })

assert.doesNotMatch(sources['Invoke-Preflight.ps1'], /Install-Package|Enable-WindowsOptionalFeature|Disable-WindowsOptionalFeature|Remove-Item|Start-Process|Set-ItemProperty|New-NetFirewallRule|Register-ScheduledTask/i)
assert.match(sources['Invoke-Preflight.ps1'], /CLEAN_ENOUGH/)
assert.match(sources['Invoke-Preflight.ps1'], /CONTAMINATED_FOR_STRICT_TEST/)
assert.match(sources['Invoke-Preflight.ps1'], /UNSUITABLE/)
assert.match(sources['Invoke-Preflight.ps1'], /Installed VC redistributables do not change classification/)
assert.match(sources['Verify-SyncServiceModule.ps1'], /APPLICATION_DIRECTORY\/vcruntime140\.dll/)
assert.deepEqual(nativeContract.aiPackFiles, ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'])
assert.match(sources['Verify-LlamaModules.ps1'], /foreach \(\$name in @\(\$contract\.aiPackFiles\)\)/)
assert.doesNotMatch(Object.values(sources).join('\n'), /\$env:(?:USERNAME|COMPUTERNAME)|MachineName|UserName/i)
assert.match(sources['Collect-Evidence.ps1'], /windows-native-validation-result\.json/)
assert.match(sources['Collect-Evidence.ps1'], /finalVerdict/)

const readme = await readFile(join(root, 'README.md'), 'utf8')
for (let step = 1; step <= 11; step += 1) assert.match(readme, new RegExp(`^${step}\\.`, 'm'))
assert.match(readme, /do not install VC_redist/i)
assert.match(readme, /CLEAN_ENOUGH/)

const builder = await readFile(join(root, 'Build-WindowsNativeValidationKit.ps1'), 'utf8')
assert.match(builder, /Output directory must be outside the repository/)
assert.match(builder, /Output already exists/)
assert.doesNotMatch(builder, /Remove-Item|Invoke-WebRequest|Start-BitsTransfer|https?:\/\//i)
console.log('PASS Windows native validation kit source policy and Windows PowerShell syntax')
