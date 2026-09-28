param(
  [Parameter(Mandatory=$true)][ValidateSet('FreshInstalled','FinalInstalled','Uninstalled')][string]$Stage,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9._-]+\.json$')][string]$OutputName,
  [switch]$AcknowledgeDisposableEnvironment
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$kit = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'Test-Preflight.ps1') -Stage $Stage -AcknowledgeDisposableEnvironment:$AcknowledgeDisposableEnvironment
$paths = Get-TargetPaths $kit
$state = Get-SystemIntegration $kit
Write-JsonFile (Join-Path $paths.Evidence $OutputName) ([ordered]@{
  formatVersion=1; stage=$Stage; capturedAtUtc=[DateTime]::UtcNow.ToString('o'); systemIntegration=$state
})
Write-Host "PASS: sanitized system-integration state captured as $OutputName"
