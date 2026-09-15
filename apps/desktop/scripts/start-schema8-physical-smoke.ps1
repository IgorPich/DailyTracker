param([switch]$Reset)
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$desktopExecutable = Join-Path $repoRoot 'apps\desktop\src-tauri\target\debug\greekgod.exe'
$serviceExecutable = Join-Path $repoRoot 'apps\sync-service\target\debug\greekgod-sync-service.exe'
$identifier = 'com.igorpich.formlog.schema8smoke'
$stableIdentifier = 'com.igorpich.formlog'
$appDataRoot = (Resolve-Path -LiteralPath $env:APPDATA).Path
$smokeRoot = Join-Path $appDataRoot $identifier
$productionRoot = Join-Path $appDataRoot $stableIdentifier
$databasePath = Join-Path $smokeRoot 'greekgod-v3.sqlite'
$pairingPath = Join-Path $smokeRoot 'schema8-pairing.json'
$sessionPath = Join-Path $smokeRoot 'schema8-session.json'

if ($smokeRoot -eq $productionRoot -or $smokeRoot.StartsWith("$productionRoot\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Schema-8 smoke root overlaps production AppData.'
}
foreach ($executable in @($desktopExecutable, $serviceExecutable)) {
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Missing smoke build: $executable" }
}
if ((Test-Path -LiteralPath $smokeRoot) -and $Reset) {
  $resolvedSmokeRoot = (Resolve-Path -LiteralPath $smokeRoot).Path
  if ((Split-Path -Parent $resolvedSmokeRoot) -ne $appDataRoot -or (Split-Path -Leaf $resolvedSmokeRoot) -ne $identifier) {
    throw "Refusing to archive unexpected directory: $resolvedSmokeRoot"
  }
  $archivePath = "$resolvedSmokeRoot.pre-smoke-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
  Move-Item -LiteralPath $resolvedSmokeRoot -Destination $archivePath
}
if (Test-Path -LiteralPath $sessionPath -PathType Leaf) {
  $previous = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
  foreach ($processId in @($previous.desktopPid, $previous.servicePid)) {
    if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
      throw "Schema-8 smoke process $processId is already running."
    }
  }
}
New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
if (Test-Path -LiteralPath $pairingPath) { Remove-Item -LiteralPath $pairingPath -Force }

$desktop = Start-Process -FilePath $desktopExecutable -PassThru
$deadline = [DateTime]::UtcNow.AddSeconds(45)
while (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
  if ($desktop.HasExited) { throw "Desktop exited before creating isolated database (code $($desktop.ExitCode))." }
  if ([DateTime]::UtcNow -ge $deadline) { throw 'Timed out waiting for isolated Desktop database.' }
  Start-Sleep -Milliseconds 200
}

$deadline = [DateTime]::UtcNow.AddSeconds(45)
$auditOutput = $null
do {
  $auditOutput = & node --experimental-sqlite (Join-Path $PSScriptRoot 'audit-schema8-physical-state.mjs') $databasePath $smokeRoot $productionRoot 2>&1
  if ($LASTEXITCODE -eq 0) { break }
  if ($desktop.HasExited) { throw "Desktop exited before bootstrapping isolated database (code $($desktop.ExitCode))." }
  if ([DateTime]::UtcNow -ge $deadline) { throw "Isolated schema-8 database audit failed: $auditOutput" }
  Start-Sleep -Milliseconds 200
} while ($true)
Write-Output $auditOutput

$serviceStdout = Join-Path $smokeRoot 'sync-service.stdout.log'
$serviceStderr = Join-Path $smokeRoot 'sync-service.stderr.log'
$service = Start-Process -FilePath $serviceExecutable -ArgumentList @(
  '--database', $databasePath,
  '--bind-private-lan',
  '--service-id', 'greekgod-schema8-physical-smoke',
  '--pairing-window-seconds', '3600',
  '--pairing-nonce-output', $pairingPath
) -RedirectStandardOutput $serviceStdout -RedirectStandardError $serviceStderr -PassThru -WindowStyle Hidden
$deadline = [DateTime]::UtcNow.AddSeconds(45)
while (-not (Test-Path -LiteralPath $pairingPath -PathType Leaf)) {
  if ($service.HasExited) { throw "Sync Service exited before pairing became ready (code $($service.ExitCode)). See $serviceStderr" }
  if ([DateTime]::UtcNow -ge $deadline) { throw 'Timed out waiting for schema-8 pairing window.' }
  Start-Sleep -Milliseconds 200
}

$pairing = Get-Content -LiteralPath $pairingPath -Raw | ConvertFrom-Json
[ordered]@{
  desktopPid = $desktop.Id
  servicePid = $service.Id
  desktopIdentifier = $identifier
  desktopAppData = $smokeRoot
  databasePath = $databasePath
  mobileApplicationId = 'com.igorpich.greekgod.mobile.schema8test'
  protocolVersion = 1
  schemaVersion = 8
  baseUrl = $pairing.baseUrl
  nonce = $pairing.nonce
  certificateFingerprintSha256 = $pairing.certificateFingerprintSha256
  expiresAtEpoch = $pairing.expiresAtEpoch
} | ConvertTo-Json | Set-Content -LiteralPath $sessionPath -Encoding UTF8

Start-Process -FilePath notepad.exe -ArgumentList $sessionPath
Write-Output "Schema-8 physical smoke is ready. Pair from: $sessionPath"
