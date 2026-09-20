param([switch]$AcknowledgeDisposableEnvironment)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$kit = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'Test-Preflight.ps1') -Stage Clean -AcknowledgeDisposableEnvironment:$AcknowledgeDisposableEnvironment
$paths = Get-TargetPaths $kit
$source = Join-Path $kit 'data'
$manifest = Get-Content -LiteralPath (Join-Path $source 'rehearsal-data-manifest.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path $paths.AppData | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'greekgod-v3.sqlite') -Destination $paths.Database
Assert-FileHash $paths.Database ([string]$manifest.databaseSha256)
[ordered]@{ formatVersion=1; classification='SANITIZED_REHEARSAL_COPY'; installedAtUtc=[DateTime]::UtcNow.ToString('o') } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $paths.AppData '.greekgod-upgrade-rehearsal.json') -Encoding UTF8
Write-Host 'PASS: sanitized schema-7 rehearsal data installed. Run SeededData preflight next.'
