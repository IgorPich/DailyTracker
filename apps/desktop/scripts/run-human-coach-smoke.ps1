$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$exe = Join-Path $repo 'apps/desktop/src-tauri/target/debug/greekgod.exe'
$smokeDir = Join-Path $env:APPDATA 'com.igorpich.formlog.humancoachsmoke'
$resultPath = Join-Path $smokeDir 'human-coach-smoke-result.json'
$contextPath = Join-Path $smokeDir 'greekgod-human-coach.v1.json'
$productionDir = Join-Path $env:APPDATA 'com.igorpich.formlog'
function ProductionHashes {
  if (Test-Path -LiteralPath $productionDir) {
    Get-ChildItem -LiteralPath $productionDir -File | Where-Object { $_.Name -match '\.json$|\.sqlite($|-)' } | Sort-Object Name | ForEach-Object {
      '{0} {1}' -f $_.Name, (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
  }
}
function Wait-Result($process, $started) {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($process.HasExited) { throw 'Primary smoke process exited unexpectedly' }
    if (Test-Path -LiteralPath $resultPath) {
      $result = (Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json).result
      if ($result -and ([DateTime]$result.at).ToUniversalTime() -ge $started) {
        if ($result.status -ne 'pass') { throw 'WebView persistence smoke failed' }
        return $result
      }
    }
    Start-Sleep -Milliseconds 200
  }
  throw 'WebView smoke timed out'
}
function Close-Smoke($process) {
  $process.Refresh()
  if (-not $process.CloseMainWindow()) { throw 'Could not close primary test window normally' }
  if (-not $process.WaitForExit(10000)) { throw 'Primary window close did not release process' }
}
if (Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe }) { throw 'Test executable is already running' }
$before = @(ProductionHashes)
$started = [DateTime]::UtcNow
$first = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
try {
  $result = Wait-Result $first $started
  $hash = (Get-FileHash -LiteralPath $contextPath -Algorithm SHA256).Hash
  $second = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
  if (-not $second.WaitForExit(10000) -or $second.ExitCode -ne 0) { throw 'Second process did not exit cleanly' }
  $writers = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe })
  if ($writers.Count -ne 1 -or $writers[0].ProcessId -ne $first.Id) { throw 'Expected exactly the first writer' }
  $first.Refresh()
  if (-not $first.Responding) { throw 'First window is unresponsive' }
  if ((Get-FileHash -LiteralPath $contextPath -Algorithm SHA256).Hash -ne $hash) { throw 'Double launch changed context' }
  Close-Smoke $first
  $started = [DateTime]::UtcNow
  $reopened = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
  try {
    $restart = Wait-Result $reopened $started
    if ($restart.stage -ne 'reopened') { throw 'Expected persisted context on restart' }
    if ((Get-FileHash -LiteralPath $contextPath -Algorithm SHA256).Hash -ne $hash) { throw 'Restart changed file bytes' }
    Close-Smoke $reopened
  } finally { if (-not $reopened.HasExited) { $null = $reopened.CloseMainWindow() } }
  if (Compare-Object $before @(ProductionHashes)) { throw 'Production file hashes changed during smoke' }
  Write-Output "PASS first launch, second exit=0, one writer PID=$($first.Id), responsive first window, normal close, guard release, exact restart; path=$contextPath; SHA256=$hash; production hashes unchanged"
} finally { if (-not $first.HasExited) { $null = $first.CloseMainWindow() } }
