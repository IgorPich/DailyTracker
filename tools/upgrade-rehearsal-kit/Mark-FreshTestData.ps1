param([switch]$AcknowledgeDisposableEnvironment)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-DisposableAcknowledgement $AcknowledgeDisposableEnvironment.IsPresent
$kit = Split-Path $PSScriptRoot -Parent
$paths = Get-TargetPaths $kit
$system = Get-SystemIntegration $kit
if (-not $system.installPresent -or $system.productVersion -ne '4.0.0-rc.1') { throw 'Install the exact Phase 6 artifact before creating the fresh-test marker.' }
if (Test-Path -LiteralPath $paths.AppData) {
  if (@(Get-ChildItem -LiteralPath $paths.AppData -Force).Count -ne 0) { throw 'Fresh-test AppData already exists and is not empty.' }
} else {
  New-Item -ItemType Directory -Path $paths.AppData | Out-Null
}
[ordered]@{ formatVersion=1; kitId='greekgod-phase6-installer-validation'; classification='PHASE6_FRESH_DISPOSABLE'; installedAtUtc=[DateTime]::UtcNow.ToString('o') } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $paths.AppData $script:MarkerName) -Encoding UTF8
Write-Host 'PASS: kit-owned marker created for fresh disposable AppData.'
