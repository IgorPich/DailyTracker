$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$executable = Join-Path $repoRoot 'apps\sync-service\target\debug\greekgod-sync-service.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "Sync Service executable does not exist: $executable"
}

$artifactRoot = Join-Path $repoRoot ".artifacts\sync-service-smoke-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
New-Item -ItemType Directory -Path $artifactRoot | Out-Null
$databasePath = Join-Path $artifactRoot 'greekgod-v3.sqlite'
$stdoutPath = Join-Path $artifactRoot 'service.stdout.log'
$stderrPath = Join-Path $artifactRoot 'service.stderr.log'
$pairingPath = Join-Path $artifactRoot 'pairing.json'

function Get-FreeLoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

$port = Get-FreeLoopbackPort
$bind = "127.0.0.1:$port"
$baseUrl = "http://$bind"
$service = Start-Process -FilePath $executable -ArgumentList @(
  '--database', $databasePath,
  '--bind', $bind,
  '--service-id', 'service-http-smoke',
  '--pairing-window-seconds', '120',
  '--pairing-nonce-output', $pairingPath
) -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden

try {
  $health = $null
  for ($attempt = 0; $attempt -lt 50 -and $null -eq $health; $attempt += 1) {
    try { $health = Invoke-RestMethod -Uri "$baseUrl/v1/health" -Method Get } catch { Start-Sleep -Milliseconds 100 }
  }
  if ($null -eq $health) { throw 'Sync Service health endpoint did not become ready.' }
  if ($health.serviceId -ne 'service-http-smoke' -or $health.protocolVersion -ne 1 -or $health.schemaVersion -ne 4) {
    throw "Unexpected health response: $($health | ConvertTo-Json -Compress)"
  }
  if (-not (Test-Path -LiteralPath $pairingPath -PathType Leaf)) {
    throw 'Pairing output was not created for the explicit pairing window.'
  }

  $compatibility = @{
    appVersion = '3.0.0-smoke'
    protocolMin = 1
    protocolMax = 1
    schemaMin = 4
    schemaMax = 4
    deviceId = 'mobile-http-smoke'
    lastServerRevision = 0
  }

  $anonymousRejected = $false
  try {
    Invoke-RestMethod -Uri "$baseUrl/v1/handshake" -Method Post -ContentType 'application/json' -Body ($compatibility | ConvertTo-Json) | Out-Null
  } catch {
    $anonymousRejected = ([int]$_.Exception.Response.StatusCode -eq 401)
  }
  if (-not $anonymousRejected) { throw 'Anonymous handshake was not rejected with HTTP 401.' }

  $pairingWindow = Get-Content -LiteralPath $pairingPath -Raw | ConvertFrom-Json
  $pairBody = @{
    nonce = $pairingWindow.nonce
    deviceId = 'mobile-http-smoke'
    displayName = 'HTTP smoke phone'
  } | ConvertTo-Json
  $paired = Invoke-RestMethod -Uri "$baseUrl/v1/pair" -Method Post -ContentType 'application/json' -Body $pairBody
  if ($paired.serviceId -ne 'service-http-smoke' -or $paired.credentials.deviceToken.Length -ne 64) {
    throw 'Pairing did not return the expected service and 256-bit device token.'
  }
  $pairReplayRejected = $false
  try {
    Invoke-RestMethod -Uri "$baseUrl/v1/pair" -Method Post -ContentType 'application/json' -Body $pairBody | Out-Null
  } catch {
    $pairReplayRejected = ([int]$_.Exception.Response.StatusCode -eq 403)
  }
  if (-not $pairReplayRejected) { throw 'Pairing nonce replay was not rejected with HTTP 403.' }

  $authHeaders = @{
    Authorization = "Bearer $($paired.credentials.deviceToken)"
    'X-GreekGod-Device-Id' = 'mobile-http-smoke'
  }
  $handshake = Invoke-RestMethod -Uri "$baseUrl/v1/handshake" -Method Post -Headers $authHeaders -ContentType 'application/json' -Body ($compatibility | ConvertTo-Json)
  if ($handshake.serverRevision -ne 0) { throw 'Fresh handshake revision must be zero.' }

  $operation = @{
    operationId = '40000000-0000-4000-8000-000000000001'
    changeSetId = '41000000-0000-4000-8000-000000000001'
    deviceId = 'mobile-http-smoke'
    entityType = 'workout'
    entityId = 'http-smoke-workout'
    baseRevision = 0
    orderPosition = 0
    operationType = 'upsert'
    payload = @{
      id = 'http-smoke-workout'
      date = '2026-08-26'
      templateId = 'template-a'
      templateCode = 'A'
      templateName = 'PUSH'
      exercises = @()
    }
  }
  $pushBody = @{ compatibility = $compatibility; operations = @($operation) } | ConvertTo-Json -Depth 20
  $firstPush = Invoke-RestMethod -Uri "$baseUrl/v1/sync/push" -Method Post -Headers $authHeaders -ContentType 'application/json' -Body $pushBody
  $replayedPush = Invoke-RestMethod -Uri "$baseUrl/v1/sync/push" -Method Post -Headers $authHeaders -ContentType 'application/json' -Body $pushBody
  if ($firstPush.serverRevision -ne 1 -or $firstPush.outcomes[0].result.idempotentReplay) {
    throw 'First HTTP push did not create exactly one revision.'
  }
  if ($replayedPush.serverRevision -ne 1 -or -not $replayedPush.outcomes[0].result.idempotentReplay) {
    throw 'Replayed HTTP push was not idempotent.'
  }

  $pullBody = @{ compatibility = $compatibility; afterRevision = 0; limit = 100 } | ConvertTo-Json -Depth 10
  $pull = Invoke-RestMethod -Uri "$baseUrl/v1/sync/pull" -Method Post -Headers $authHeaders -ContentType 'application/json' -Body $pullBody
  if ($pull.serverRevision -ne 1 -or $pull.changes.Count -ne 1 -or $pull.changes[0].entityId -ne 'http-smoke-workout') {
    throw 'HTTP pull did not return the accepted workout.'
  }

  $secondPort = Get-FreeLoopbackPort
  $second = Start-Process -FilePath $executable -ArgumentList @(
    '--database', $databasePath,
    '--bind', "127.0.0.1:$secondPort",
    '--service-id', 'service-http-smoke-second'
  ) -RedirectStandardOutput (Join-Path $artifactRoot 'second.stdout.log') -RedirectStandardError (Join-Path $artifactRoot 'second.stderr.log') -PassThru -WindowStyle Hidden
  if (-not $second.WaitForExit(5000)) {
    Stop-Process -Id $second.Id -Force
    throw 'Second service instance did not fail closed.'
  }
  if ($second.ExitCode -eq 0) { throw 'Second service instance unexpectedly succeeded.' }

  $service.Refresh()
  $logs = ((Get-Content -LiteralPath $stdoutPath -Raw) + (Get-Content -LiteralPath $stderrPath -Raw))
  if ($logs.Contains($pairingWindow.nonce) -or $logs.Contains($paired.credentials.deviceToken)) {
    throw 'Pairing nonce or device token leaked into service logs.'
  }

  Write-Output "PASS Sync Service HTTP smoke — explicit one-time pairing, authenticated handshake, idempotent push, pull, single-instance, secret-safe logs"
  Write-Output "Artifacts: $artifactRoot"
} finally {
  if (-not $service.HasExited) { Stop-Process -Id $service.Id -Force }
}
