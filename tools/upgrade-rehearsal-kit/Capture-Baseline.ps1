param([switch]$AcknowledgeDisposableEnvironment)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$kit = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'Test-Preflight.ps1') -Stage StableInstalled -AcknowledgeDisposableEnvironment:$AcknowledgeDisposableEnvironment
Assert-AppClosed
$paths = Get-TargetPaths $kit
Invoke-StrictNative (Join-Path $kit 'bin\greekgod-upgrade-rehearsal-verifier.exe') @('capture',$paths.Database,(Join-Path $paths.Evidence 'baseline.json'),'stable-baseline','3.0.3','7',(Join-Path $kit 'data\expectations.json')) 'Stable baseline capture'
