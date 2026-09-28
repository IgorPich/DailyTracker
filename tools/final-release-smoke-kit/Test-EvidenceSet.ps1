param(
  [Parameter(Mandatory=$true)][string]$EvidenceRoot,
  [Parameter(Mandatory=$true)][string]$UxChecklistPath
)
$ErrorActionPreference = 'Stop'
$required = @(
  'fresh-install-system.json','fresh-uninstalled-system.json',
  'baseline.json',
  'post-upgrade.json','restart-2.json','restart-3.json',
  'upgrade-comparison.json','restart-2-comparison.json','restart-3-comparison.json','final-system.json'
)
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $EvidenceRoot $name) -PathType Leaf)) { throw "Evidence is missing: $name" }
}
foreach ($name in @('upgrade-comparison.json','restart-2-comparison.json','restart-3-comparison.json')) {
  $comparison = Get-Content -LiteralPath (Join-Path $EvidenceRoot $name) -Raw | ConvertFrom-Json
  if ($comparison.verdict -ne 'PASS') { throw "Comparison failed: $name" }
}
$baseline = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'baseline.json') -Raw | ConvertFrom-Json
$first = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'post-upgrade.json') -Raw | ConvertFrom-Json
$second = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'restart-2.json') -Raw | ConvertFrom-Json
$third = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'restart-3.json') -Raw | ConvertFrom-Json
if ($baseline.schemaVersion -ne 7 -or $first.schemaVersion -ne 8) { throw 'Evidence schema sequence must be 7 -> 8.' }
if ($baseline.protocolVersion -ne 1 -or $first.protocolVersion -ne 1) { throw 'Protocol must remain 1.' }
$finalCaptures = @($first,$second,$third)
if ($baseline.appVersion -ne '3.0.3' -or @($finalCaptures | Where-Object { $_.appVersion -ne '4.0.0' }).Count -ne 0) {
  throw 'Evidence ProductVersion sequence must be stable 3.0.3 followed by final 4.0.0.'
}
$freshSystem = (Get-Content -LiteralPath (Join-Path $EvidenceRoot 'fresh-install-system.json') -Raw | ConvertFrom-Json).systemIntegration
$uninstalledSystem = (Get-Content -LiteralPath (Join-Path $EvidenceRoot 'fresh-uninstalled-system.json') -Raw | ConvertFrom-Json).systemIntegration
$finalSystem = (Get-Content -LiteralPath (Join-Path $EvidenceRoot 'final-system.json') -Raw | ConvertFrom-Json).systemIntegration
if ($freshSystem.productVersion -ne '4.0.0' -or $finalSystem.productVersion -ne '4.0.0') { throw 'Fresh and upgraded system evidence must identify ProductVersion 4.0.0.' }
if ($uninstalledSystem.installPresent -or $uninstalledSystem.taskCount -ne 0 -or $uninstalledSystem.firewallRuleCount -ne 0 -or $uninstalledSystem.processCount -ne 0) {
  throw 'Fresh uninstall evidence is not clean.'
}
$checklist = Get-Content -LiteralPath $UxChecklistPath -Raw | ConvertFrom-Json
$invalid = @($checklist.items | Where-Object { $_.status -ne 'PASS' -or [string]::IsNullOrWhiteSpace([string]$_.evidence) })
if ($invalid.Count -ne 0) { throw 'UX checklist requires explicit PASS and concise evidence for every item.' }
Write-Host 'PASS: evidence set has final version identity, schema, protocol, comparisons, system snapshots, and human UX verdicts.'
