$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$executable = Join-Path $repoRoot 'apps\desktop\src-tauri\target\debug\greekgod.exe'
$expectedIdentifier = 'com.igorpich.formlog.sqlitesmoke'
$smokeRoot = Join-Path $env:APPDATA $expectedIdentifier
$resultPath = Join-Path $smokeRoot 'sqlite-smoke-result.json'

if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "SQLite smoke executable does not exist: $executable"
}

if (Test-Path -LiteralPath $smokeRoot) {
  $resolvedSmokeRoot = (Resolve-Path -LiteralPath $smokeRoot).Path
  $resolvedAppData = (Resolve-Path -LiteralPath $env:APPDATA).Path
  if ((Split-Path -Parent $resolvedSmokeRoot) -ne $resolvedAppData -or (Split-Path -Leaf $resolvedSmokeRoot) -ne $expectedIdentifier) {
    throw "Refusing to move unexpected smoke directory: $resolvedSmokeRoot"
  }
  $archivePath = "$resolvedSmokeRoot.pre-smoke-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
  if ((Split-Path -Parent $archivePath) -ne $resolvedAppData) {
    throw "Refusing to archive outside AppData: $archivePath"
  }
  Move-Item -LiteralPath $resolvedSmokeRoot -Destination $archivePath
  Write-Output "Archived prior isolated smoke data: $archivePath"
}

function Invoke-SmokeRun([string]$Label) {
  $startedAt = [DateTime]::UtcNow
  $process = Start-Process -FilePath $executable -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit(30000)) {
    Stop-Process -Id $process.Id -Force
    throw "$Label timed out after 30 seconds."
  }
  if ($process.ExitCode -ne 0) {
    throw "$Label exited with code $($process.ExitCode)."
  }
  if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
    throw "$Label did not write $resultPath."
  }
  $resultDocument = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
  $result = $resultDocument.result
  if ($result.status -ne 'pass') {
    throw "$Label failed: $($result.kind) $($result.message)"
  }
  $completedAt = if ($result.completedAt -is [DateTime]) {
    $result.completedAt.ToUniversalTime()
  } else {
    [DateTime]::Parse(
      [string]$result.completedAt,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    ).ToUniversalTime()
  }
  if ($completedAt -lt $startedAt) {
    throw "$Label returned a stale result."
  }
  if (-not (Test-Path -LiteralPath $result.databasePath -PathType Leaf)) {
    throw "$Label database path is missing: $($result.databasePath)"
  }
  if (-not (Test-Path -LiteralPath $result.backupPath -PathType Leaf)) {
    throw "$Label backup path is missing: $($result.backupPath)"
  }
  Write-Output "$Label PASS — SQLite $($result.sqliteVersion), schema $($result.schemaVersion), journal $($result.journalMode)"
}

Invoke-SmokeRun 'Fresh database WebView smoke'
Invoke-SmokeRun 'Existing database WebView smoke'
