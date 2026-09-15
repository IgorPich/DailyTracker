$ErrorActionPreference = 'Stop'
$identifier = 'com.igorpich.formlog.schema8smoke'
$appDataRoot = (Resolve-Path -LiteralPath $env:APPDATA).Path
$smokeRoot = Join-Path $appDataRoot $identifier
$sessionPath = Join-Path $smokeRoot 'schema8-session.json'
if (-not (Test-Path -LiteralPath $sessionPath -PathType Leaf)) { throw 'No schema-8 smoke session was found.' }
$session = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
foreach ($processId in @($session.servicePid, $session.desktopPid)) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process) { Stop-Process -Id $process.Id }
}
Write-Output 'Schema-8 smoke processes stopped. Isolated test data was preserved.'
