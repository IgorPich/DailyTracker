param([switch]$AcknowledgeDisposableEnvironment)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$kit = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'Test-Preflight.ps1') -Stage FinalInstalled -AcknowledgeDisposableEnvironment:$AcknowledgeDisposableEnvironment
$paths = Get-TargetPaths $kit
$verifier = Join-Path $kit 'bin\greekgod-upgrade-rehearsal-verifier.exe'
$pairs = @(
  @('baseline.json','post-upgrade.json','upgrade-comparison.json'),
  @('post-upgrade.json','restart-2.json','restart-2-comparison.json'),
  @('restart-2.json','restart-3.json','restart-3-comparison.json')
)
foreach ($pair in $pairs) {
  Invoke-StrictNative $verifier @('compare-version',(Join-Path $paths.Evidence $pair[0]),(Join-Path $paths.Evidence $pair[1]),'4.0.0',(Join-Path $paths.Evidence $pair[2])) 'Deterministic final comparison'
}
& (Join-Path $PSScriptRoot 'Capture-SystemState.ps1') -Stage FinalInstalled -OutputName 'final-system.json' -AcknowledgeDisposableEnvironment
& (Join-Path $PSScriptRoot 'Test-EvidenceSet.ps1') -EvidenceRoot $paths.Evidence -UxChecklistPath (Join-Path $kit 'ux-checklist.json')
$baseline = Get-Content -LiteralPath (Join-Path $paths.Evidence 'baseline.json') -Raw | ConvertFrom-Json
$first = Get-Content -LiteralPath (Join-Path $paths.Evidence 'post-upgrade.json') -Raw | ConvertFrom-Json
$system = Get-Content -LiteralPath (Join-Path $paths.Evidence 'final-system.json') -Raw | ConvertFrom-Json
$bundle = [ordered]@{
  formatVersion=2; finalVerdict='PASS'; collectedAtUtc=[DateTime]::UtcNow.ToString('o')
  environment=[ordered]@{ osVersion=[Environment]::OSVersion.Version.ToString(); architecture='x64'; disposableAcknowledged=$true }
  installers=[ordered]@{
    stable=[ordered]@{ file='GreekGod_3.0.3_x64-setup.exe'; bytes=(Get-Item (Join-Path $kit $paths.Config.stableInstaller)).Length; sha256=$script:StableSha256 }
    final=[ordered]@{ file='GreekGod_4.0.0_x64-setup.exe'; bytes=$script:FinalBytes; sha256=$script:FinalSha256; policy='PRIVATE_UNSIGNED'; updatePolicy='MANUAL_PRIVATE' }
  }
  seed=[ordered]@{ classification='SANITIZED_REHEARSAL_COPY'; sha256=$paths.Config.seedDatabaseSha256 }
  schema=[ordered]@{ baseline=$baseline.schemaVersion; upgraded=$first.schemaVersion; protocol=$first.protocolVersion }
  product=[ordered]@{ version=$system.systemIntegration.productVersion; installPath='%LOCALAPPDATA%\GreekGod'; appDataPath='%APPDATA%\com.igorpich.formlog' }
  comparisons=@('upgrade-comparison.json','restart-2-comparison.json','restart-3-comparison.json')
  systemEvidence=@('fresh-install-system.json','fresh-uninstalled-system.json','final-system.json')
  uxChecklist='..\ux-checklist.json'
}
Write-JsonFile (Join-Path $paths.Evidence 'FINAL-EVIDENCE.json') $bundle
Write-Host "PASS: compact sanitized evidence is in $($paths.Evidence)"
