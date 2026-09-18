$ErrorActionPreference = 'Stop'

$assetRoot = 'C:\Users\Smoke\GreekGodDev\companion-product-ux-smoke-assets'
$processes = @(
  [pscustomobject]@{ CommandLine = $null },
  [pscustomobject]@{ CommandLine = 'llama-server.exe --model C:\unrelated\model.gguf' },
  [pscustomobject]@{ CommandLine = 'llama-server.exe --model C:\USERS\SMOKE\GREEKGODDEV\COMPANION-PRODUCT-UX-SMOKE-ASSETS\model.gguf' }
)
$managed = @($processes | Where-Object {
  $_.CommandLine -and $_.CommandLine.IndexOf($assetRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
})

if ($managed.Count -ne 1) { throw "Expected exactly one case-insensitive smoke-sidecar match; found $($managed.Count)." }
if ($managed[0].CommandLine -notmatch 'COMPANION-PRODUCT-UX-SMOKE-ASSETS') { throw 'Matched an unexpected process.' }

$json = ConvertTo-Json -InputObject @([pscustomobject]@{ label = 'one' })
foreach ($label in @('two', 'three')) {
  $decoded = $json | ConvertFrom-Json
  if ($decoded -is [Array]) { $existing = @($decoded | ForEach-Object { $_ }) }
  elseif ($null -eq $decoded) { $existing = @() }
  else { $existing = @($decoded) }
  $json = ConvertTo-Json -InputObject @($existing + [pscustomobject]@{ label = $label }) -Depth 4
}
$records = $json | ConvertFrom-Json
if ($records.Count -ne 3 -or ($records | ForEach-Object { $_.label }) -join ',' -ne 'one,two,three') {
  throw 'PowerShell 5.1 observation-array round trip was not flat.'
}

Write-Output 'Companion smoke process filter compatibility: PASS'
