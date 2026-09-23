[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'NativeValidation.Common.ps1')
$contract = Get-NativeContract
$runtime = Get-ActiveRuntimeDirectory
$expectedServer = Join-Path $runtime 'llama-server.exe'
$processInfo = @(Get-CimInstance Win32_Process -Filter "Name = 'llama-server.exe'" | Where-Object { Test-SamePath $_.ExecutablePath $expectedServer })
if ($processInfo.Count -ne 1) { throw 'MANAGED_LLAMA_PROCESS_NOT_UNIQUE_OR_RUNNING' }
$process = Get-Process -Id $processInfo[0].ProcessId -ErrorAction Stop
$results = @()
foreach ($name in @($contract.aiPackFiles)) {
  $definition = @($contract.files | Where-Object { $_.name -eq $name })
  if ($definition.Count -ne 1) { throw "NATIVE_RUNTIME_CONTRACT_INVALID: $name" }
  $expectedPath = Join-Path $runtime $name
  $module = @($process.Modules | Where-Object { $_.ModuleName -ieq $name })
  if ($module.Count -ne 1 -or -not (Test-SamePath $module[0].FileName $expectedPath)) { throw "LLAMA_MODULE_ORIGIN_INVALID: $name" }
  $evidence = Get-SafeFileEvidence $module[0].FileName ('ACTIVE_AI_PACK/runtime/' + $name)
  if ($evidence.bytes -ne $definition[0].bytes -or $evidence.sha256 -ne $definition[0].sha256 -or $evidence.fileVersion -ne $definition[0].fileVersion) { throw "NATIVE_PREREQUISITE_INVALID: $name" }
  $results += $evidence
}
$result = [ordered]@{ result='PASS'; process='llama-server.exe'; modules=$results }
Write-SafeJson 'llama-server-modules.json' $result | Out-Null
$result | ConvertTo-Json -Depth 8
