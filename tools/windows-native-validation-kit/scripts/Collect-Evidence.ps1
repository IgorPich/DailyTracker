[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'NativeValidation.Common.ps1')
$evidence = Get-EvidenceDirectory
$required = @{
  preflight='preflight.json'
  aiPack='ai-pack-verification.json'
  trackerLaunch='tracker-launch.json'
  syncService='sync-service-module.json'
  companionInference='companion-inference.json'
  llamaServer='llama-server-modules.json'
  noOrphan='no-orphan.json'
}
$values = @{}
$missing = @()
foreach ($key in $required.Keys) {
  $path = Join-Path $evidence $required[$key]
  if (Test-Path -LiteralPath $path -PathType Leaf) { $values[$key] = Read-Json $path } else { $missing += $required[$key] }
}
$manifest = Get-KitManifest
$verdict = 'INCOMPLETE'
if ($missing.Count -eq 0) {
  $allPass = $values.aiPack.result -eq 'PASS' -and $values.trackerLaunch.result -eq 'PASS' -and $values.syncService.result -eq 'PASS' -and $values.companionInference.result -eq 'PASS' -and $values.llamaServer.result -eq 'PASS' -and $values.noOrphan.result -eq 'PASS'
  if ($allPass -and $values.preflight.classification -eq 'CLEAN_ENOUGH') { $verdict = 'PASS' } else { $verdict = 'FAIL' }
}
$result = [ordered]@{
  formatVersion=1
  os=$(if($values.ContainsKey('preflight')){$values.preflight.os}else{$null})
  architecture=$(if($values.ContainsKey('preflight')){$values.preflight.architecture}else{$null})
  preflightClassification=$(if($values.ContainsKey('preflight')){$values.preflight.classification}else{$null})
  installer=[ordered]@{ fileName=$manifest.installer.fileName; bytes=$manifest.installer.bytes; sha256=$manifest.installer.sha256 }
  aiPack=$(if($values.ContainsKey('aiPack')){$values.aiPack}else{$null})
  trackerLaunch=$(if($values.ContainsKey('trackerLaunch')){$values.trackerLaunch}else{$null})
  syncService=$(if($values.ContainsKey('syncService')){$values.syncService}else{$null})
  companionInference=$(if($values.ContainsKey('companionInference')){$values.companionInference}else{$null})
  llamaServer=$(if($values.ContainsKey('llamaServer')){$values.llamaServer}else{$null})
  noOrphan=$(if($values.ContainsKey('noOrphan')){$values.noOrphan}else{$null})
  missingEvidence=$missing
  finalVerdict=$verdict
}
$path = Write-SafeJson 'windows-native-validation-result.json' $result
Write-Output "Evidence: $path"
$result | ConvertTo-Json -Depth 12
if ($verdict -ne 'PASS') { exit 1 }
