$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$desktopExecutable = Join-Path $repoRoot 'apps\desktop\src-tauri\target\debug\greekgod.exe'
$serviceExecutable = Join-Path $repoRoot 'apps\sync-service\target\debug\greekgod-sync-service.exe'
$clientExecutable = Join-Path $repoRoot 'apps\sync-service\target\debug\examples\pinned_https_client.exe'
foreach ($executable in @($desktopExecutable, $serviceExecutable, $clientExecutable)) {
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Shared authority smoke executable is missing: $executable"
  }
}

$identifier = 'com.igorpich.formlog.authoritylivesmoke'
$smokeRoot = Join-Path $env:APPDATA $identifier
$readyPath = Join-Path $smokeRoot 'authority-live-ready.json'
$resultPath = Join-Path $smokeRoot 'authority-live-result.json'
$desktopEditAck = Join-Path $smokeRoot 'authority-live-desktop-edit-ack.json'
$databasePath = Join-Path $smokeRoot 'greekgod-v3.sqlite'

if (Test-Path -LiteralPath $smokeRoot) {
  $resolvedSmokeRoot = (Resolve-Path -LiteralPath $smokeRoot).Path
  $resolvedAppData = (Resolve-Path -LiteralPath $env:APPDATA).Path
  if ((Split-Path -Parent $resolvedSmokeRoot) -ne $resolvedAppData -or (Split-Path -Leaf $resolvedSmokeRoot) -ne $identifier) {
    throw "Refusing to move unexpected live smoke directory: $resolvedSmokeRoot"
  }
  $archivePath = "$resolvedSmokeRoot.pre-smoke-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
  Move-Item -LiteralPath $resolvedSmokeRoot -Destination $archivePath
  Write-Output "Archived prior isolated live smoke data: $archivePath"
}

$artifactRoot = Join-Path $repoRoot ".artifacts\shared-authority-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
New-Item -ItemType Directory -Path $artifactRoot | Out-Null
$pairingPath = Join-Path $artifactRoot 'pairing.json'
$closedAck = Join-Path $artifactRoot 'desktop-closed.ack'
$serviceStdout = Join-Path $artifactRoot 'service.stdout.log'
$serviceStderr = Join-Path $artifactRoot 'service.stderr.log'
$clientStdout = Join-Path $artifactRoot 'client.stdout.log'
$clientStderr = Join-Path $artifactRoot 'client.stderr.log'

function Wait-ForFile([string]$Path, [System.Diagnostics.Process]$Process, [int]$TimeoutSeconds = 30) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) { return }
    if ($null -ne $Process -and $Process.HasExited) { throw "Process exited before creating $Path" }
    Start-Sleep -Milliseconds 100
  }
  throw "Timed out waiting for $Path"
}

function Wait-ForExit([System.Diagnostics.Process]$Process, [int]$TimeoutSeconds, [string]$Label) {
  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $Process.Id -Force
    throw "$Label timed out."
  }
  if ($Process.ExitCode -ne 0) { throw "$Label exited with code $($Process.ExitCode)." }
}

function Read-Result([string]$ExpectedPhase) {
  $document = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
  if ($document.result.status -ne 'pass' -or $document.result.phase -ne $ExpectedPhase) {
    throw "Desktop phase $ExpectedPhase failed: $($document.result.message)"
  }
  return $document.result
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
try { $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
$bind = "127.0.0.1:$port"

$desktop = $null
$service = $null
$client = $null
try {
  $desktop = Start-Process -FilePath $desktopExecutable -PassThru -WindowStyle Hidden
  Wait-ForFile -Path $readyPath -Process $desktop
  if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) { throw 'Desktop did not create the shared SQLite database.' }

  $service = Start-Process -FilePath $serviceExecutable -ArgumentList @(
    '--database', $databasePath,
    '--bind', $bind,
    '--service-id', 'shared-authority-smoke',
    '--pairing-window-seconds', '120',
    '--pairing-nonce-output', $pairingPath
  ) -RedirectStandardOutput $serviceStdout -RedirectStandardError $serviceStderr -PassThru -WindowStyle Hidden
  Wait-ForFile -Path $pairingPath -Process $service
  $pairing = Get-Content -LiteralPath $pairingPath -Raw | ConvertFrom-Json

  $client = Start-Process -FilePath $clientExecutable -ArgumentList @(
    'shared-authority',
    "https://$bind",
    $pairing.certificateFingerprintSha256,
    $pairing.nonce,
    $desktopEditAck,
    $closedAck
  ) -RedirectStandardOutput $clientStdout -RedirectStandardError $clientStderr -PassThru -WindowStyle Hidden

  Wait-ForExit -Process $desktop -TimeoutSeconds 45 -Label 'Open Desktop live smoke'
  $openResult = Read-Result -ExpectedPhase 'open'
  New-Item -ItemType File -Path $closedAck | Out-Null
  Wait-ForExit -Process $client -TimeoutSeconds 30 -Label 'Shared pinned HTTPS client'

  $desktop = Start-Process -FilePath $desktopExecutable -PassThru -WindowStyle Hidden
  Wait-ForExit -Process $desktop -TimeoutSeconds 30 -Label 'Reopened Desktop smoke'
  $reopenResult = Read-Result -ExpectedPhase 'reopen'

  & node --experimental-sqlite (Join-Path $PSScriptRoot 'audit-shared-authority.mjs') $databasePath
  if ($LASTEXITCODE -ne 0) { throw 'Shared authority SQLite audit failed.' }
  $logs = (Get-Content -LiteralPath $serviceStdout -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $serviceStderr -Raw -ErrorAction SilentlyContinue)
  if ($logs -match 'SQLITE_BUSY|database is locked|database disk image is malformed') {
    throw 'Shared authority logs contain a SQLite concurrency failure.'
  }
  Write-Output "PASS live Desktop + Service — open revision $($openResult.revision), reopen revision $($reopenResult.revision), polling and closed-start visibility verified"
  Write-Output "Artifacts: $artifactRoot"
} finally {
  foreach ($process in @($client, $service, $desktop)) {
    if ($null -ne $process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force
      $process.WaitForExit()
    }
  }
}
