$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'invoke-smoke-node.ps1')

$identifier = 'com.igorpich.formlog.schema8smoke'
$appDataRoot = (Resolve-Path -LiteralPath $env:APPDATA).Path
$smokeRoot = Join-Path $appDataRoot $identifier
$productionRoot = Join-Path $appDataRoot 'com.igorpich.formlog'
$sessionPath = Join-Path $smokeRoot 'companion-ux-smoke-session.json'

if (-not (Test-Path -LiteralPath $sessionPath -PathType Leaf)) {
  throw 'No isolated Companion UX smoke session was found.'
}
$session = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
if ($session.desktopIdentifier -ne $identifier -or [IO.Path]::GetFullPath($session.desktopAppData) -ne [IO.Path]::GetFullPath($smokeRoot)) {
  throw 'Smoke session identity/path mismatch.'
}
if (-not (Get-Process -Id $session.desktopPid -ErrorAction SilentlyContinue)) {
  throw 'The isolated Companion UX Desktop is not running.'
}

$auditOutput = Invoke-SmokeNode -Label 'Confirmed command persistence audit' -Arguments @(
  '--no-warnings', '--experimental-strip-types', '--experimental-sqlite',
  (Join-Path $PSScriptRoot 'audit-companion-product-ux-smoke.mjs'),
  $smokeRoot, $productionRoot, '3 × 6–8'
)
Write-Output $auditOutput
Write-Output 'Confirmed command persisted exactly as 3 × 6–8 in isolated schema-8 storage.'
