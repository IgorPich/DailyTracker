param([switch]$Reset, [switch]$StageAssets)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'invoke-smoke-node.ps1')

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$identifier = 'com.igorpich.formlog.schema8smoke'
$productionIdentifier = 'com.igorpich.formlog'
$appDataRoot = (Resolve-Path -LiteralPath $env:APPDATA).Path
$smokeRoot = Join-Path $appDataRoot $identifier
$productionRoot = Join-Path $appDataRoot $productionIdentifier
$assetRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'GreekGodDev\companion-product-ux-smoke-assets'))
$productionAssetRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "$productionIdentifier\companion-managed-runtime"))
$desktopExecutable = Join-Path $repoRoot 'apps\desktop\src-tauri\target\debug\greekgod.exe'
$databasePath = Join-Path $smokeRoot 'greekgod-v3.sqlite'
$fixturePath = Join-Path $smokeRoot 'companion-ux-smoke-fixture.json'
$sessionPath = Join-Path $smokeRoot 'companion-ux-smoke-session.json'
$productionSnapshotPath = Join-Path $smokeRoot 'production-snapshot-before.json'

function Get-ProductionSnapshot {
  if (-not (Test-Path -LiteralPath $productionRoot -PathType Container)) { return @() }
  return @(Get-ChildItem -LiteralPath $productionRoot -File | Sort-Object Name | ForEach-Object {
    [ordered]@{ name = $_.Name; length = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
  })
}

$resolvedSmoke = [IO.Path]::GetFullPath($smokeRoot)
$resolvedProduction = [IO.Path]::GetFullPath($productionRoot)
if ($resolvedSmoke -eq $resolvedProduction -or $resolvedSmoke.StartsWith("$resolvedProduction\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Companion UX smoke AppData overlaps production.'
}
if ((Split-Path -Parent $resolvedSmoke) -ne $appDataRoot -or (Split-Path -Leaf $resolvedSmoke) -ne $identifier) {
  throw 'Companion UX smoke AppData did not resolve to the exact allowlisted test identifier.'
}
if ($assetRoot -eq $productionAssetRoot -or $assetRoot.StartsWith("$productionAssetRoot\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Companion UX smoke assets overlap production managed assets.'
}
if (Test-Path -LiteralPath $sessionPath -PathType Leaf) {
  $previous = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
  foreach ($processId in @($previous.desktopPid, $previous.controllerPid)) {
    if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { throw "Smoke process $processId is already running." }
  }
}
if (Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $desktopExecutable }) {
  throw 'The repository debug Desktop executable is already running.'
}

if ($StageAssets) { & (Join-Path $PSScriptRoot 'prepare-companion-product-ux-smoke-assets.ps1') -Stage | Out-Null }
else { & (Join-Path $PSScriptRoot 'prepare-companion-product-ux-smoke-assets.ps1') | Out-Null }

if (Test-Path -LiteralPath $smokeRoot) {
  $existingRoot = (Resolve-Path -LiteralPath $smokeRoot).Path
  if ($existingRoot -ne $resolvedSmoke) { throw "Refusing to archive unexpected path: $existingRoot" }
  if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
    throw 'Existing isolated AppData has no Companion UX synthetic marker; refusing automatic reset.'
  }
  $existingFixture = Get-Content -LiteralPath $fixturePath -Raw | ConvertFrom-Json
  if ($existingFixture.syntheticOnly -ne $true) { throw 'Existing isolated AppData is not marked synthetic; refusing automatic reset.' }
  $archivePath = "$existingRoot.previous-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
  if ((Split-Path -Parent $archivePath) -ne $appDataRoot) { throw 'Unsafe smoke archive destination.' }
  Move-Item -LiteralPath $existingRoot -Destination $archivePath
  Write-Output "Preserved previous isolated smoke data at $archivePath"
}
$seedOutput = Invoke-SmokeNode -Label 'Synthetic Companion UX seed' -Arguments @(
  '--no-warnings', '--experimental-strip-types',
  (Join-Path $PSScriptRoot 'seed-companion-product-ux-smoke.mjs'), $smokeRoot, $productionRoot
)
if ($seedOutput) { Write-Output $seedOutput }
if (-not (Test-Path -LiteralPath $fixturePath -PathType Leaf)) { throw 'Synthetic Companion UX seed did not create its fixture marker.' }
ConvertTo-Json -InputObject @(Get-ProductionSnapshot) -Depth 4 | Set-Content -LiteralPath $productionSnapshotPath -Encoding UTF8

$stdoutPath = Join-Path $smokeRoot 'companion-ux-tauri.stdout.log'
$stderrPath = Join-Path $smokeRoot 'companion-ux-tauri.stderr.log'
$oldRuntimeRoot = $env:GREEKGOD_MANAGED_RUNTIME_ROOT
$oldAuthority = $env:VITE_NATIVE_SQLITE_AUTHORITY
$oldDevOptLevel = $env:CARGO_PROFILE_DEV_OPT_LEVEL
$env:GREEKGOD_MANAGED_RUNTIME_ROOT = $assetRoot
$env:VITE_NATIVE_SQLITE_AUTHORITY = '1'
# The physical smoke uses a dev binary; optimize it so the pinned 2 GiB SHA-256
# verification completes within the same bounded product timeout as release builds.
$env:CARGO_PROFILE_DEV_OPT_LEVEL = '2'
try {
  $startedAt = [DateTime]::UtcNow
  $controller = Start-Process -FilePath 'npm.cmd' -ArgumentList @(
    'run', 'tauri', '--workspace', '@greekgod/desktop', '--', 'dev',
    '--features', 'native-sqlite-authority', '--config', 'src-tauri/tauri.companion-product-ux-smoke.conf.json'
  ) -WorkingDirectory $repoRoot -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden
} finally {
  $env:GREEKGOD_MANAGED_RUNTIME_ROOT = $oldRuntimeRoot
  $env:VITE_NATIVE_SQLITE_AUTHORITY = $oldAuthority
  $env:CARGO_PROFILE_DEV_OPT_LEVEL = $oldDevOptLevel
}

$desktop = $null
try {
  $deadline = [DateTime]::UtcNow.AddMinutes(4)
  while (-not $desktop) {
    if ($controller.HasExited) { throw "Tauri dev controller exited before Desktop launch (code $($controller.ExitCode)). See $stderrPath" }
    $candidate = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $desktopExecutable } | Select-Object -First 1
    if ($candidate) { $desktop = Get-Process -Id $candidate.ProcessId -ErrorAction Stop; break }
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Timed out waiting for isolated Companion UX Desktop.' }
    Start-Sleep -Milliseconds 500
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
    if ($desktop.HasExited) { throw "Desktop exited before isolated SQLite bootstrap (code $($desktop.ExitCode))." }
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Timed out waiting for isolated SQLite bootstrap.' }
    Start-Sleep -Milliseconds 250
  }
  $bootstrapOutput = Invoke-SmokeNode -Label 'Isolated SQLite bootstrap readiness' -Arguments @(
    '--no-warnings', '--experimental-sqlite',
    (Join-Path $PSScriptRoot 'wait-companion-product-ux-bootstrap.mjs'), $smokeRoot, $productionRoot, '60000'
  )
  if ($bootstrapOutput) { Write-Output $bootstrapOutput }
  $auditOutput = Invoke-SmokeNode -Label 'Synthetic smoke state audit' -Arguments @(
    '--no-warnings', '--experimental-strip-types', '--experimental-sqlite',
    (Join-Path $PSScriptRoot 'audit-companion-product-ux-smoke.mjs'), $smokeRoot, $productionRoot
  )
  $managed = @(Get-CimInstance Win32_Process -Filter "name='llama-server.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains($assetRoot, [StringComparison]::OrdinalIgnoreCase)
  })
  if ($managed.Count -ne 0) { throw 'Cold-start guard failed: managed sidecar exists before Companion use.' }
  [ordered]@{
    controllerPid = $controller.Id
    desktopPid = $desktop.Id
    desktopIdentifier = $identifier
    desktopExecutable = $desktopExecutable
    desktopAppData = $resolvedSmoke
    databasePath = $databasePath
    managedAssetRoot = $assetRoot
    runtimePath = Join-Path $assetRoot 'runtime\llama.cpp-b10760'
    modelPath = Join-Path $assetRoot 'models\Phi-3.5-mini-instruct-Q4_0.gguf'
    syntheticFixture = $fixturePath
    productionAppData = $resolvedProduction
    productionSnapshotBefore = $productionSnapshotPath
    syncServiceStarted = $false
    coldSidecarPid = $null
    startedAt = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $sessionPath -Encoding UTF8
  & (Join-Path $PSScriptRoot 'record-companion-product-ux-smoke-state.ps1') -Label 'cold-ai-unused' -ExpectedSidecar Absent | Out-Null
  Write-Output $auditOutput
  Write-Output "Companion Product UX smoke is ready. Desktop PID=$($desktop.Id); isolated AppData=$resolvedSmoke"
} catch {
  if ($desktop -and -not $desktop.HasExited) { Stop-Process -Id $desktop.Id -Force -ErrorAction SilentlyContinue }
  if ($controller -and -not $controller.HasExited) { Stop-Process -Id $controller.Id -Force -ErrorAction SilentlyContinue }
  throw
}
