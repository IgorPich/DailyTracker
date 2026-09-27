param([switch]$AcknowledgeDisposableEnvironment)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-DisposableAcknowledgement $AcknowledgeDisposableEnvironment.IsPresent
$kit = Split-Path $PSScriptRoot -Parent
$paths = Get-TargetPaths $kit
& (Join-Path $PSScriptRoot 'Test-Preflight.ps1') -Stage Uninstalled -AcknowledgeDisposableEnvironment
$marker = Get-RehearsalMarker $paths.AppData
if ($marker.kitId -ne 'greekgod-phase6-installer-validation' -or $marker.classification -ne 'PHASE6_FRESH_DISPOSABLE') {
  throw 'Refusing deletion: AppData is not the kit-owned fresh disposable state.'
}
$resolved = (Resolve-Path -LiteralPath $paths.AppData).Path
$expected = [IO.Path]::GetFullPath((Join-Path $env:APPDATA $script:ProductAppDataName))
if (-not $resolved.Equals($expected,[StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing deletion: resolved AppData path is unexpected.' }
Remove-Item -LiteralPath $resolved -Recurse -Force
Write-Host 'PASS: removed only marker-proven fresh disposable AppData.'
