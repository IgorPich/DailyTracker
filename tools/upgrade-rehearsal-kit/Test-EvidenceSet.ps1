param(
  [Parameter(Mandatory=$true)][string]$EvidenceRoot,
  [Parameter(Mandatory=$true)][string]$UxChecklistPath
)
$ErrorActionPreference = 'Stop'
$required = @(
  'fresh-install-system.json','fresh-uninstalled-system.json',
  'baseline.json','cancelled-upgrade.json','cancellation-comparison.json','cancelled-system.json',
  'post-upgrade.json','restart-2.json','restart-3.json',
  'upgrade-comparison.json','restart-2-comparison.json','restart-3-comparison.json','phase6-system.json'
)
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $EvidenceRoot $name) -PathType Leaf)) { throw "Evidence is missing: $name" }
}
foreach ($name in @('cancellation-comparison.json','upgrade-comparison.json','restart-2-comparison.json','restart-3-comparison.json')) {
  $comparison = Get-Content -LiteralPath (Join-Path $EvidenceRoot $name) -Raw | ConvertFrom-Json
  if ($comparison.verdict -ne 'PASS') { throw "Comparison failed: $name" }
}
$baseline = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'baseline.json') -Raw | ConvertFrom-Json
$cancelled = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'cancelled-upgrade.json') -Raw | ConvertFrom-Json
$first = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'post-upgrade.json') -Raw | ConvertFrom-Json
if ($baseline.schemaVersion -ne 7 -or $cancelled.schemaVersion -ne 7 -or $first.schemaVersion -ne 8) { throw 'Evidence schema sequence must be 7 -> cancelled 7 -> upgraded 8.' }
if ($baseline.protocolVersion -ne 1 -or $cancelled.protocolVersion -ne 1 -or $first.protocolVersion -ne 1) { throw 'Protocol must remain 1.' }
$checklist = Get-Content -LiteralPath $UxChecklistPath -Raw | ConvertFrom-Json
$invalid = @($checklist.items | Where-Object { $_.status -ne 'PASS' -or [string]::IsNullOrWhiteSpace([string]$_.evidence) })
if ($invalid.Count -ne 0) { throw 'UX checklist requires explicit PASS and concise evidence for every item.' }
Write-Host 'PASS: evidence set has the required schema, protocol, comparisons, system snapshots, and human UX verdicts.'
