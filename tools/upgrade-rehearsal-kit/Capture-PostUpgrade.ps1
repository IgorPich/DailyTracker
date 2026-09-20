param(
  [Parameter(Mandatory=$true)][ValidateSet('First','Second','Third')][string]$LaunchNumber,
  [switch]$AcknowledgeDisposableEnvironment
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$kit = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'Test-Preflight.ps1') -Stage Rc1Installed -AcknowledgeDisposableEnvironment:$AcknowledgeDisposableEnvironment
Assert-AppClosed
$paths = Get-TargetPaths $kit
$names = @{ First='post-upgrade.json'; Second='restart-2.json'; Third='restart-3.json' }
$stages = @{ First='rc1-first-launch'; Second='rc1-second-launch'; Third='rc1-third-launch' }
Invoke-StrictNative (Join-Path $kit 'bin\greekgod-upgrade-rehearsal-verifier.exe') @('capture',$paths.Database,(Join-Path $paths.Evidence $names[$LaunchNumber]),$stages[$LaunchNumber],'4.0.0-rc.1','8',(Join-Path $kit 'data\expectations.json')) 'RC1 post-upgrade capture'
