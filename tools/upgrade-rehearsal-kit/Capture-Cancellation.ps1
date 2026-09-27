param([switch]$AcknowledgeDisposableEnvironment)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$kit = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'Test-Preflight.ps1') -Stage CancelledUpgrade -AcknowledgeDisposableEnvironment:$AcknowledgeDisposableEnvironment
Assert-AppClosed
$paths = Get-TargetPaths $kit
$verifier = Join-Path $kit 'bin\greekgod-upgrade-rehearsal-verifier.exe'
$cancelled = Join-Path $paths.Evidence 'cancelled-upgrade.json'
Invoke-ReadOnlyDatabaseCommand $verifier 'capture' $paths.Database @($cancelled,'cancelled-upgrade','3.0.3','7',(Join-Path $kit 'data\expectations.json')) 'Cancellation capture'
Invoke-StrictNative $verifier @('compare-cancellation',(Join-Path $paths.Evidence 'baseline.json'),$cancelled,(Join-Path $paths.Evidence 'cancellation-comparison.json')) 'Cancellation comparison'
& (Join-Path $PSScriptRoot 'Capture-SystemState.ps1') -Stage CancelledUpgrade -OutputName 'cancelled-system.json' -AcknowledgeDisposableEnvironment
Write-Host 'PASS: cancelled upgrade preserved the stable canonical state and system integration.'
