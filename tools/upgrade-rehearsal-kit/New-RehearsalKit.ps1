param(
  [Parameter(Mandatory=$true)][string]$OutputRoot,
  [Parameter(Mandatory=$true)][string]$StableInstaller,
  [Parameter(Mandatory=$true)][string]$Rc1Installer,
  [Parameter(Mandatory=$true)][string]$RehearsalDataRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$output = [IO.Path]::GetFullPath($OutputRoot)
if (Test-Path -LiteralPath $output) { throw "OutputRoot already exists; choose a new empty path: $output" }
$production = Join-Path $env:APPDATA $script:ProductAppDataName
Assert-PathOutside $RehearsalDataRoot $production 'RehearsalDataRoot'
Assert-PathOutside $output $production 'OutputRoot'
Assert-FileHash $StableInstaller $script:StableSha256
Assert-FileHash $Rc1Installer $script:Rc1Sha256

$dataManifest = Join-Path $RehearsalDataRoot 'rehearsal-data-manifest.json'
$expectations = Join-Path $RehearsalDataRoot 'expectations.json'
$database = Join-Path $RehearsalDataRoot 'greekgod-v3.sqlite'
foreach ($required in @($dataManifest, $expectations, $database)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Sanitized data package is incomplete: $required" }
}
$manifest = Get-Content -LiteralPath $dataManifest -Raw | ConvertFrom-Json
if ($manifest.syntheticOnly -ne $true -or $manifest.sourceClassification -ne 'SANITIZED_REHEARSAL_COPY') {
  throw 'Data manifest must declare syntheticOnly=true and sourceClassification=SANITIZED_REHEARSAL_COPY.'
}
Assert-FileHash $database ([string]$manifest.databaseSha256)
$forbidden = @(Get-ChildItem -LiteralPath $RehearsalDataRoot -File -Recurse | Where-Object {
  $_.Name -match '(?i)(token|nonce|secret|private|certificate|pairing|\.key$|\.pfx$|\.pem$)'
})
if ($forbidden.Count -ne 0) { throw 'Sanitized data package contains a forbidden secret-like filename.' }

$verifierManifest = Join-Path (Split-Path $PSScriptRoot -Parent) 'upgrade-rehearsal-verifier\Cargo.toml'
$rustFlagsBefore = $env:RUSTFLAGS
try {
  $env:RUSTFLAGS = '-C target-feature=+crt-static'
  Invoke-StrictNative 'cargo.exe' @('build','--release','--locked','--manifest-path',$verifierManifest) 'Rehearsal verifier build'
} finally { $env:RUSTFLAGS = $rustFlagsBefore }
$verifier = Join-Path (Split-Path $verifierManifest -Parent) 'target\release\greekgod-upgrade-rehearsal-verifier.exe'
Invoke-StrictNative $verifier @('audit-seed',$database,$expectations) 'Sanitized seed audit'

New-Item -ItemType Directory -Path $output | Out-Null
foreach ($folder in @('installers','data','scripts','docs','bin','evidence')) { New-Item -ItemType Directory -Path (Join-Path $output $folder) | Out-Null }
Copy-Item -LiteralPath $StableInstaller -Destination (Join-Path $output 'installers\GreekGod_3.0.3_x64-setup.exe')
Copy-Item -LiteralPath $Rc1Installer -Destination (Join-Path $output 'installers\GreekGod_4.0.0-rc.1_x64-setup.exe')
Get-ChildItem -LiteralPath $RehearsalDataRoot -Force | Copy-Item -Destination (Join-Path $output 'data') -Recurse
Copy-Item -LiteralPath $verifier -Destination (Join-Path $output 'bin\greekgod-upgrade-rehearsal-verifier.exe')
Get-ChildItem -LiteralPath $PSScriptRoot -File -Filter '*.ps1' | Where-Object { $_.Name -ne 'New-RehearsalKit.ps1' } | Copy-Item -Destination (Join-Path $output 'scripts')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination $output
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'UNINSTALL-AUDIT.md') -Destination (Join-Path $output 'docs')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ai-free-checklist.json') -Destination $output
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'installer-behavior-checklist.json') -Destination $output
$config = [ordered]@{
  formatVersion = 1; sourceMachine = $env:COMPUTERNAME; sourceUser = $env:USERNAME
  stableInstaller = 'installers\GreekGod_3.0.3_x64-setup.exe'; stableSha256 = $script:StableSha256
  rc1Installer = 'installers\GreekGod_4.0.0-rc.1_x64-setup.exe'; rc1Sha256 = $script:Rc1Sha256
  seedDatabaseSha256 = ([string]$manifest.databaseSha256).ToUpperInvariant()
  expectationsSha256 = (Get-FileHash -LiteralPath $expectations -Algorithm SHA256).Hash.ToUpperInvariant()
  dataManifestSha256 = (Get-FileHash -LiteralPath $dataManifest -Algorithm SHA256).Hash.ToUpperInvariant()
  dataDirectory = 'data'; expectedInstallPath = '%LOCALAPPDATA%\GreekGod'; expectedAppDataPath = '%APPDATA%\com.igorpich.formlog'
}
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'kit-config.json') -Encoding UTF8
Write-Host "PASS: portable rehearsal kit created at $output"
