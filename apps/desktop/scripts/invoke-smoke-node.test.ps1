$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'invoke-smoke-node.ps1')
$fixture = Join-Path $PSScriptRoot 'smoke-node-stream-fixture.mjs'

$empty = @(Invoke-SmokeNode -Label 'empty streams' -Arguments @($fixture, 'empty'))
if ($empty.Count -ne 0) { throw 'Empty stdout/stderr should produce no pipeline output.' }

$stdout = Invoke-SmokeNode -Label 'stdout only' -Arguments @($fixture, 'stdout')
if ($stdout -ne 'fixture stdout') { throw "Unexpected stdout result: $stdout" }

foreach ($failure in @(
  @{ Mode = 'stderr'; ExitCode = 0 },
  @{ Mode = 'both'; ExitCode = 0 },
  @{ Mode = 'nonzero'; ExitCode = 7 }
)) {
  try {
    Invoke-SmokeNode -Label $failure.Mode -Arguments @($fixture, $failure.Mode)
    throw "Expected $($failure.Mode) to fail."
  } catch {
    $message = $_.Exception.Message
    if ($message -notmatch "exit code $($failure.ExitCode)") { throw }
    if ($message -notmatch 'STDOUT:' -or $message -notmatch 'STDERR:') { throw }
    if ($message -notmatch 'fixture stderr') { throw }
  }
}

Write-Output 'Invoke-SmokeNode stream and exit handling: PASS'
