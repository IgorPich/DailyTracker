param([switch]$AcknowledgeDisposableEnvironment)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$kit = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'Test-Preflight.ps1') -Stage Rc1Installed -AcknowledgeDisposableEnvironment:$AcknowledgeDisposableEnvironment
$paths = Get-TargetPaths $kit
$verifier = Join-Path $kit 'bin\greekgod-upgrade-rehearsal-verifier.exe'
$pairs = @(
  @('baseline.json','post-upgrade.json','upgrade-comparison.json'),
  @('post-upgrade.json','restart-2.json','restart-2-comparison.json'),
  @('restart-2.json','restart-3.json','restart-3-comparison.json')
)
foreach ($pair in $pairs) {
  Invoke-StrictNative $verifier @('compare',(Join-Path $paths.Evidence $pair[0]),(Join-Path $paths.Evidence $pair[1]),(Join-Path $paths.Evidence $pair[2])) 'Deterministic upgrade comparison'
}
$checklistPath = Join-Path $kit 'ai-free-checklist.json'
$checklist = Get-Content -LiteralPath $checklistPath -Raw | ConvertFrom-Json
$notPassed = @($checklist.items | Where-Object { $_.status -ne 'PASS' })
if ($notPassed.Count -ne 0) { throw 'AI-free checklist contains PENDING/FAIL items.' }
$installerChecklistPath = Join-Path $kit 'installer-behavior-checklist.json'
$installerChecklist = Get-Content -LiteralPath $installerChecklistPath -Raw | ConvertFrom-Json
$installerNotPassed = @($installerChecklist.items | Where-Object { $_.status -ne 'PASS' })
if ($installerNotPassed.Count -ne 0) { throw 'Installer behavior checklist contains PENDING/FAIL items.' }
$bundle = [ordered]@{
  formatVersion=1; verdict='PASS'; collectedAtUtc=[DateTime]::UtcNow.ToString('o')
  machine=$env:COMPUTERNAME; user=$env:USERNAME; os=[Environment]::OSVersion.Version.ToString()
  installerHashes=[ordered]@{stable=$script:StableSha256;rc1=$script:Rc1Sha256}; seedDatabaseSha256=$paths.Config.seedDatabaseSha256
  comparisons=@('upgrade-comparison.json','restart-2-comparison.json','restart-3-comparison.json')
  checklists=@('..\ai-free-checklist.json','..\installer-behavior-checklist.json')
}
$bundle | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $paths.Evidence 'FINAL-EVIDENCE.json') -Encoding UTF8
Write-Host "PASS: complete evidence is in $($paths.Evidence)"
