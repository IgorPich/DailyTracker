param([string]$KitRoot = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$kit = [IO.Path]::GetFullPath($KitRoot)
$config = Read-KitConfig $kit
if ($config.formatVersion -ne 1 -or $config.purpose -ne 'FINAL_4_0_0_PHYSICAL_SMOKE') { throw 'Unexpected kit contract.' }
Assert-FileHash (Join-Path $kit $config.stableInstaller) $script:StableSha256
Assert-FileHash (Join-Path $kit $config.finalInstaller) $script:FinalSha256
if ((Get-Item -LiteralPath (Join-Path $kit $config.finalInstaller)).Length -ne $script:FinalBytes) { throw 'Final installer size mismatch.' }
foreach ($name in @('greekgod-v3.sqlite','expectations.json','rehearsal-data-manifest.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $kit "data\$name") -PathType Leaf)) { throw "Missing sanitized data file: $name" }
}
if (@(Get-ChildItem -LiteralPath (Join-Path $kit 'data') -File).Count -ne 3) { throw 'Portable data directory must contain exactly three files.' }
Assert-FileHash (Join-Path $kit 'data\greekgod-v3.sqlite') ([string]$config.seedDatabaseSha256)
Invoke-ReadOnlyDatabaseCommand (Join-Path $kit 'bin\greekgod-upgrade-rehearsal-verifier.exe') 'audit-seed' (Join-Path $kit 'data\greekgod-v3.sqlite') @((Join-Path $kit 'data\expectations.json')) 'Portable seed audit'
Write-Host 'PASS: portable final 4.0.0 kit identity and sanitized seed are exact.'
