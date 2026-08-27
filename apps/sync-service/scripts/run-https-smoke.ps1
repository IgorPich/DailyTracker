param(
  [string]$BindAddress = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$serviceExecutable = Join-Path $repoRoot 'apps\sync-service\target\debug\greekgod-sync-service.exe'
$clientExecutable = Join-Path $repoRoot 'apps\sync-service\target\debug\examples\pinned_https_client.exe'
$discoveryExecutable = Join-Path $repoRoot 'apps\sync-service\target\debug\examples\discover_service.exe'
foreach ($executable in @($serviceExecutable, $clientExecutable, $discoveryExecutable)) {
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Required TLS smoke executable does not exist: $executable"
  }
}

$artifactRoot = Join-Path $repoRoot ".artifacts\sync-service-tls-smoke-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
New-Item -ItemType Directory -Path $artifactRoot | Out-Null
$databasePath = Join-Path $artifactRoot 'greekgod-v3.sqlite'

function Get-FreeBindPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse($BindAddress), 0)
  $listener.Start()
  try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Get-FreeLoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Wait-ForFile {
  param([string]$Path, [System.Diagnostics.Process]$Process)
  for ($attempt = 0; $attempt -lt 100; $attempt += 1) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) { return }
    if ($Process.HasExited) { throw 'Sync Service exited before creating pairing bootstrap.' }
    Start-Sleep -Milliseconds 100
  }
  throw 'Pairing bootstrap was not created in time.'
}

function Stop-ServiceProcess {
  param([System.Diagnostics.Process]$Process)
  if ($null -ne $Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force
    $Process.WaitForExit()
  }
}

function Assert-SecretsNotLogged {
  param([string[]]$Paths, [string[]]$Secrets)
  $logs = ''
  foreach ($path in $Paths) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $logs += Get-Content -LiteralPath $path -Raw
    }
  }
  foreach ($secret in $Secrets) {
    if (-not [string]::IsNullOrEmpty($secret) -and $logs.Contains($secret)) {
      throw 'Pairing nonce leaked into Sync Service logs.'
    }
  }
}

$expiredPairingPath = Join-Path $artifactRoot 'expired-pairing.json'
$expiredStdout = Join-Path $artifactRoot 'expired.stdout.log'
$expiredStderr = Join-Path $artifactRoot 'expired.stderr.log'
$expiredPort = Get-FreeLoopbackPort
$expiredBind = "127.0.0.1:$expiredPort"
$expiredService = Start-Process -FilePath $serviceExecutable -ArgumentList @(
  '--database', $databasePath,
  '--bind', $expiredBind,
  '--service-id', 'service-tls-smoke',
  '--pairing-window-seconds', '1',
  '--pairing-nonce-output', $expiredPairingPath
) -RedirectStandardOutput $expiredStdout -RedirectStandardError $expiredStderr -PassThru -WindowStyle Hidden

try {
  Wait-ForFile -Path $expiredPairingPath -Process $expiredService
  $expiredBootstrap = Get-Content -LiteralPath $expiredPairingPath -Raw | ConvertFrom-Json
  Start-Sleep -Milliseconds 2200
  & $clientExecutable 'expired' "https://$expiredBind" $expiredBootstrap.certificateFingerprintSha256 $expiredBootstrap.nonce
  if ($LASTEXITCODE -ne 0) { throw 'Expired-nonce pinned HTTPS client gate failed.' }
  Assert-SecretsNotLogged -Paths @($expiredStdout, $expiredStderr) -Secrets @($expiredBootstrap.nonce)
} finally {
  Stop-ServiceProcess -Process $expiredService
}

$pairingPath = Join-Path $artifactRoot 'pairing.json'
$stdoutPath = Join-Path $artifactRoot 'service.stdout.log'
$stderrPath = Join-Path $artifactRoot 'service.stderr.log'
$port = Get-FreeBindPort
$bind = "${BindAddress}:$port"
$service = Start-Process -FilePath $serviceExecutable -ArgumentList @(
  '--database', $databasePath,
  '--bind', $bind,
  '--service-id', 'service-tls-smoke',
  '--pairing-window-seconds', '120',
  '--pairing-nonce-output', $pairingPath
) -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden

try {
  Wait-ForFile -Path $pairingPath -Process $service
  $pairingBootstrap = Get-Content -LiteralPath $pairingPath -Raw | ConvertFrom-Json
  if ($pairingBootstrap.serviceId -ne $expiredBootstrap.serviceId -or
      $pairingBootstrap.certificateFingerprintSha256 -ne $expiredBootstrap.certificateFingerprintSha256) {
    throw 'Service restart changed the persisted serviceId or certificate fingerprint.'
  }

  if (-not [Net.IPAddress]::IsLoopback([Net.IPAddress]::Parse($BindAddress))) {
    & $discoveryExecutable $pairingBootstrap.serviceId $BindAddress $port
    if ($LASTEXITCODE -ne 0) { throw 'mDNS service discovery gate failed.' }
  }

  & $clientExecutable 'full' "https://$bind" $pairingBootstrap.certificateFingerprintSha256 $pairingBootstrap.nonce
  if ($LASTEXITCODE -ne 0) { throw 'Full pinned HTTPS client gate failed.' }

  $secondPort = Get-FreeBindPort
  $second = Start-Process -FilePath $serviceExecutable -ArgumentList @(
    '--database', $databasePath,
    '--bind', "${BindAddress}:$secondPort",
    '--service-id', 'service-tls-smoke'
  ) -RedirectStandardOutput (Join-Path $artifactRoot 'second.stdout.log') -RedirectStandardError (Join-Path $artifactRoot 'second.stderr.log') -PassThru -WindowStyle Hidden
  if (-not $second.WaitForExit(5000)) {
    Stop-Process -Id $second.Id -Force
    throw 'Second service instance did not fail closed.'
  }
  if ($second.ExitCode -eq 0) { throw 'Second service instance unexpectedly succeeded.' }

  Assert-SecretsNotLogged -Paths @($stdoutPath, $stderrPath) -Secrets @($pairingBootstrap.nonce)
  Write-Output 'PASS Sync Service HTTPS smoke — DPAPI identity persistence, stable pin after restart, wrong-pin rejection, expired/one-time pairing, authenticated idempotent sync, token revocation, single-instance, optional LAN mDNS discovery, secret-safe logs'
  Write-Output "Artifacts: $artifactRoot"
} finally {
  Stop-ServiceProcess -Process $service
}
