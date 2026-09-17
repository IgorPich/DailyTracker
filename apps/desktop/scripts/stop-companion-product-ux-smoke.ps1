$ErrorActionPreference = 'Stop'
$identifier = 'com.igorpich.formlog.schema8smoke'
$appDataRoot = (Resolve-Path -LiteralPath $env:APPDATA).Path
$smokeRoot = Join-Path $appDataRoot $identifier
$productionRoot = Join-Path $appDataRoot 'com.igorpich.formlog'
$sessionPath = Join-Path $smokeRoot 'companion-ux-smoke-session.json'
if (-not (Test-Path -LiteralPath $sessionPath -PathType Leaf)) { throw 'No Companion UX smoke session was found.' }
$session = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
if ($session.desktopIdentifier -ne $identifier -or [IO.Path]::GetFullPath($session.desktopAppData) -ne [IO.Path]::GetFullPath($smokeRoot)) {
  throw 'Refusing to stop a session with an unexpected identifier or AppData path.'
}
$desktop = Get-Process -Id $session.desktopPid -ErrorAction SilentlyContinue
if ($desktop) {
  $null = $desktop.CloseMainWindow()
  if (-not $desktop.WaitForExit(15000)) { Stop-Process -Id $desktop.Id -Force }
}
$controller = Get-Process -Id $session.controllerPid -ErrorAction SilentlyContinue
if ($controller) {
  if (-not $controller.WaitForExit(10000)) { Stop-Process -Id $controller.Id -Force }
}
Start-Sleep -Seconds 2
$managed = @(Get-CimInstance Win32_Process -Filter "name='llama-server.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine.Contains([string]$session.managedAssetRoot, [StringComparison]::OrdinalIgnoreCase)
})
if ($managed.Count) { throw 'Owned managed sidecar remained after Desktop close.' }

$model = Join-Path $session.managedAssetRoot 'models\Phi-3.5-mini-instruct-Q4_0.gguf'
if (-not (Test-Path -LiteralPath $model) -and (Test-Path -LiteralPath "$model.missing-smoke")) {
  & (Join-Path $PSScriptRoot 'set-companion-product-ux-smoke-model.ps1') -State Restore
}
function Get-ProductionSnapshot {
  if (-not (Test-Path -LiteralPath $productionRoot -PathType Container)) { return @() }
  return @(Get-ChildItem -LiteralPath $productionRoot -File | Sort-Object Name | ForEach-Object {
    [ordered]@{ name = $_.Name; length = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
  })
}
$before = Get-Content -LiteralPath $session.productionSnapshotBefore -Raw | ConvertFrom-Json
$after = @(Get-ProductionSnapshot)
if ((ConvertTo-Json -InputObject @($before) -Depth 4 -Compress) -ne (ConvertTo-Json -InputObject $after -Depth 4 -Compress)) {
  throw 'Production AppData snapshot changed while the isolated smoke was running. No automatic recovery was attempted.'
}
Write-Output 'Companion UX smoke processes stopped; isolated test data preserved; model restored; production snapshot unchanged.'
