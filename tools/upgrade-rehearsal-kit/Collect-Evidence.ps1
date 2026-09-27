param([switch]$AcknowledgeDisposableEnvironment)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$kit = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'Test-Preflight.ps1') -Stage Phase6Installed -AcknowledgeDisposableEnvironment:$AcknowledgeDisposableEnvironment
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
& (Join-Path $PSScriptRoot 'Capture-SystemState.ps1') -Stage Phase6Installed -OutputName 'phase6-system.json' -AcknowledgeDisposableEnvironment
& (Join-Path $PSScriptRoot 'Test-EvidenceSet.ps1') -EvidenceRoot $paths.Evidence -UxChecklistPath (Join-Path $kit 'ux-checklist.json')
$baseline = Get-Content -LiteralPath (Join-Path $paths.Evidence 'baseline.json') -Raw | ConvertFrom-Json
$cancelled = Get-Content -LiteralPath (Join-Path $paths.Evidence 'cancelled-upgrade.json') -Raw | ConvertFrom-Json
$first = Get-Content -LiteralPath (Join-Path $paths.Evidence 'post-upgrade.json') -Raw | ConvertFrom-Json
$system = Get-Content -LiteralPath (Join-Path $paths.Evidence 'phase6-system.json') -Raw | ConvertFrom-Json
$bundle = [ordered]@{
  formatVersion=2; finalVerdict='PASS'; collectedAtUtc=[DateTime]::UtcNow.ToString('o')
  environment=[ordered]@{ osVersion=[Environment]::OSVersion.Version.ToString(); architecture='x64'; disposableAcknowledged=$true }
  installers=[ordered]@{
    stable=[ordered]@{ file='GreekGod_3.0.3_x64-setup.exe'; bytes=(Get-Item (Join-Path $kit $paths.Config.stableInstaller)).Length; sha256=$script:StableSha256 }
    phase6=[ordered]@{ file='GreekGod_4.0.0-rc.1-Phase6_x64-setup.exe'; bytes=$script:Phase6Bytes; sha256=$script:Phase6Sha256; policy='PRIVATE_UNSIGNED' }
  }
  seed=[ordered]@{ classification='SANITIZED_REHEARSAL_COPY'; sha256=$paths.Config.seedDatabaseSha256 }
  schema=[ordered]@{ baseline=$baseline.schemaVersion; cancelled=$cancelled.schemaVersion; upgraded=$first.schemaVersion; protocol=$first.protocolVersion }
  product=[ordered]@{ version=$system.systemIntegration.productVersion; installPath='%LOCALAPPDATA%\GreekGod'; appDataPath='%APPDATA%\com.igorpich.formlog' }
  comparisons=@('cancellation-comparison.json','upgrade-comparison.json','restart-2-comparison.json','restart-3-comparison.json')
  systemEvidence=@('fresh-install-system.json','fresh-uninstalled-system.json','cancelled-system.json','phase6-system.json')
  uxChecklist='..\ux-checklist.json'
}
Write-JsonFile (Join-Path $paths.Evidence 'FINAL-EVIDENCE.json') $bundle
Write-Host "PASS: compact sanitized evidence is in $($paths.Evidence)"
