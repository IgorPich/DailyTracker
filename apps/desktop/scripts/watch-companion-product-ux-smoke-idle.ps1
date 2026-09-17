param([int]$TimeoutSeconds = 330)
$ErrorActionPreference = 'Stop'
$recorder = Join-Path $PSScriptRoot 'record-companion-product-ux-smoke-state.ps1'
$warm = & $recorder -Label 'warm-after-inference' -ExpectedSidecar Present | ConvertFrom-Json
$warmPid = $warm.sidecarPid
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
do {
  Start-Sleep -Seconds 2
  $alive = Get-Process -Id $warmPid -ErrorAction SilentlyContinue
  if (-not $alive) { break }
} while ([DateTime]::UtcNow -lt $deadline)
if ($alive) { throw "Managed sidecar PID $warmPid did not exit within $TimeoutSeconds seconds." }
$idle = & $recorder -Label 'idle-unloaded' -ExpectedSidecar Absent | ConvertFrom-Json
[ordered]@{
  warmPid = $warmPid
  idleObservedAt = $idle.observedAt
  sidecarExited = $true
  idleDedicatedVramBytes = $idle.dedicatedVramBytes
  evidencePath = Join-Path (Join-Path (Resolve-Path -LiteralPath $env:APPDATA).Path 'com.igorpich.formlog.schema8smoke') 'companion-resource-observations.json'
} | ConvertTo-Json
