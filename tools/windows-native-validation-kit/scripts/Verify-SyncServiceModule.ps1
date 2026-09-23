[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'NativeValidation.Common.ps1')
$contract = Get-NativeContract
$definition = @($contract.files | Where-Object { $_.name -eq 'vcruntime140.dll' })
if ($definition.Count -ne 1) { throw 'NATIVE_RUNTIME_CONTRACT_INVALID' }
$task = Get-ScheduledTask -TaskName 'GreekGod Sync Service' -ErrorAction Stop
$executable = [Environment]::ExpandEnvironmentVariables([string]$task.Actions[0].Execute).Trim('"')
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'SYNC_SERVICE_EXECUTABLE_MISSING' }
$applicationDirectory = [IO.Path]::GetDirectoryName($executable)
$expectedPath = Join-Path $applicationDirectory 'vcruntime140.dll'
$processInfo = @(Get-CimInstance Win32_Process -Filter "Name = 'greekgod-sync-service.exe'" | Where-Object { Test-SamePath $_.ExecutablePath $executable })
if ($processInfo.Count -ne 1) { throw 'SYNC_SERVICE_PROCESS_NOT_UNIQUE_OR_RUNNING' }
$process = Get-Process -Id $processInfo[0].ProcessId -ErrorAction Stop
$module = @($process.Modules | Where-Object { $_.ModuleName -ieq 'vcruntime140.dll' })
if ($module.Count -ne 1 -or -not (Test-SamePath $module[0].FileName $expectedPath)) { throw 'SYNC_SERVICE_MODULE_ORIGIN_INVALID' }
$evidence = Get-SafeFileEvidence $module[0].FileName 'APPLICATION_DIRECTORY/vcruntime140.dll'
if ($evidence.bytes -ne $definition[0].bytes -or $evidence.sha256 -ne $definition[0].sha256 -or $evidence.fileVersion -ne $definition[0].fileVersion) { throw 'NATIVE_PREREQUISITE_INVALID' }
$result = [ordered]@{ result='PASS'; process='greekgod-sync-service.exe'; module=$evidence }
Write-SafeJson 'sync-service-module.json' $result | Out-Null
$result | ConvertTo-Json -Depth 8
