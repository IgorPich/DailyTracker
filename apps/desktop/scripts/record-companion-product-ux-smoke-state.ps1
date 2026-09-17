param(
  [Parameter(Mandatory = $true)][string]$Label,
  [ValidateSet('Present', 'Absent', 'Any')][string]$ExpectedSidecar = 'Any'
)
$ErrorActionPreference = 'Stop'
$identifier = 'com.igorpich.formlog.schema8smoke'
$appDataRoot = (Resolve-Path -LiteralPath $env:APPDATA).Path
$smokeRoot = Join-Path $appDataRoot $identifier
$sessionPath = Join-Path $smokeRoot 'companion-ux-smoke-session.json'
$outputPath = Join-Path $smokeRoot 'companion-resource-observations.json'
$assetRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'GreekGodDev\companion-product-ux-smoke-assets'))
if (-not (Test-Path -LiteralPath $sessionPath -PathType Leaf)) { throw 'Companion UX smoke session is not running.' }
$session = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
if ($session.desktopIdentifier -ne $identifier -or [IO.Path]::GetFullPath($session.desktopAppData) -ne [IO.Path]::GetFullPath($smokeRoot)) {
  throw 'Smoke session identity/path mismatch.'
}
$desktop = Get-Process -Id $session.desktopPid -ErrorAction SilentlyContinue
if (-not $desktop) { throw 'Isolated Desktop process is not running.' }
$managed = @(Get-CimInstance Win32_Process -Filter "name='llama-server.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine.Contains($assetRoot, [StringComparison]::OrdinalIgnoreCase)
})
if ($managed.Count -gt 1) { throw 'More than one isolated managed sidecar is running.' }
if ($ExpectedSidecar -eq 'Present' -and $managed.Count -ne 1) { throw 'Expected one isolated managed sidecar.' }
if ($ExpectedSidecar -eq 'Absent' -and $managed.Count -ne 0) { throw 'Expected no isolated managed sidecar.' }
$sidecar = $managed | Select-Object -First 1
$workingSet = 0
$dedicatedVram = 0
if ($sidecar) {
  $process = Get-Process -Id $sidecar.ProcessId -ErrorAction Stop
  $workingSet = [int64]$process.WorkingSet64
  try {
    $samples = (Get-Counter '\GPU Process Memory(*)\Dedicated Usage' -ErrorAction Stop).CounterSamples
    $dedicatedVram = [int64](($samples | Where-Object { $_.InstanceName -match "pid_$($sidecar.ProcessId)_" } | Measure-Object CookedValue -Sum).Sum)
  } catch { $dedicatedVram = -1 }
}
$os = Get-CimInstance Win32_OperatingSystem
$record = [ordered]@{
  label = $Label
  observedAt = [DateTime]::UtcNow.ToString('o')
  desktopPid = [int]$desktop.Id
  sidecarPid = if ($sidecar) { [int]$sidecar.ProcessId } else { $null }
  sidecarWorkingSetBytes = $workingSet
  dedicatedVramBytes = $dedicatedVram
  freePhysicalMemoryBytes = [int64]$os.FreePhysicalMemory * 1024
}
$existing = @()
if (Test-Path -LiteralPath $outputPath -PathType Leaf) { $existing = @(Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json) }
@($existing + [pscustomobject]$record) | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $outputPath -Encoding UTF8
$record | ConvertTo-Json
