param([switch]$Stage)
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$sourceRoot = Join-Path $env:LOCALAPPDATA 'GreekGodDev\companion-managed-runtime'
$assetRoot = Join-Path $env:LOCALAPPDATA 'GreekGodDev\companion-product-ux-smoke-assets'
$productionAssetRoot = Join-Path $env:LOCALAPPDATA 'com.igorpich.formlog\companion-managed-runtime'
$manifestPath = Join-Path $PSScriptRoot 'managed-runtime\llama-b10760-win-vulkan-x64.manifest.json'
$modelName = 'Phi-3.5-mini-instruct-Q4_0.gguf'
$modelSha256 = 'b5374915da534cb93df39f03bd4f2cd5a0c533df0d5e21957dc9556c260be9eb'
$sourceRuntime = Join-Path $sourceRoot 'runtime\llama.cpp-b10760'
$sourceModel = Join-Path $sourceRoot "models\$modelName"
$targetRuntime = Join-Path $assetRoot 'runtime\llama.cpp-b10760'
$targetModel = Join-Path $assetRoot "models\$modelName"

foreach ($path in @($assetRoot, $sourceRoot, $productionAssetRoot)) {
  if ([string]::IsNullOrWhiteSpace($path)) { throw 'Managed asset path is empty.' }
}
$sourceResolved = [IO.Path]::GetFullPath($sourceRoot)
$targetResolved = [IO.Path]::GetFullPath($assetRoot)
$productionResolved = [IO.Path]::GetFullPath($productionAssetRoot)
if ($targetResolved -eq $sourceResolved -or $targetResolved.StartsWith("$sourceResolved\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Smoke assets must not be staged inside the approved source fixture.'
}
if ($targetResolved -eq $productionResolved -or $targetResolved.StartsWith("$productionResolved\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Smoke assets overlap the production managed asset root.'
}
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Pinned b10760 manifest is missing.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.release -ne 'b10760' -or $manifest.commit -ne '0f3a71be15af836d277c9f918adfafb45732677e' -or $manifest.files.Count -ne 24) {
  throw 'Unexpected managed runtime manifest identity or inventory.'
}

function Test-Inventory([string]$runtime, [string]$model) {
  if (-not (Test-Path -LiteralPath $runtime -PathType Container)) { throw "Runtime directory is missing: $runtime" }
  $files = @(Get-ChildItem -LiteralPath $runtime -File)
  if ($files.Count -ne $manifest.files.Count) { throw "Runtime inventory count mismatch: $($files.Count)" }
  $expectedNames = @($manifest.files.name | Sort-Object)
  $actualNames = @($files.Name | Sort-Object)
  if (Compare-Object $expectedNames $actualNames) { throw 'Runtime inventory contains missing or extra files.' }
  foreach ($entry in $manifest.files) {
    $path = Join-Path $runtime $entry.name
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $entry.sha256) { throw "Runtime checksum mismatch: $($entry.name)" }
  }
  if (-not (Test-Path -LiteralPath $model -PathType Leaf)) { throw 'Phi smoke model is missing.' }
  if ((Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash.ToLowerInvariant() -ne $modelSha256) {
    throw 'Phi smoke model checksum mismatch.'
  }
}

if ($Stage) {
  Test-Inventory $sourceRuntime $sourceModel
  if (Test-Path -LiteralPath $assetRoot) {
    $resolved = (Resolve-Path -LiteralPath $assetRoot).Path
    if ($resolved -ne $targetResolved) { throw "Refusing to archive unexpected asset path: $resolved" }
    $archive = "$resolved.previous-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))"
    if ((Split-Path -Parent $archive) -ne (Split-Path -Parent $targetResolved)) { throw 'Unsafe asset archive destination.' }
    Move-Item -LiteralPath $resolved -Destination $archive
  }
  New-Item -ItemType Directory -Path $targetRuntime -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $targetModel) -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $assetRoot 'manifests') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $assetRoot 'licenses') -Force | Out-Null
  foreach ($entry in $manifest.files) {
    Copy-Item -LiteralPath (Join-Path $sourceRuntime $entry.name) -Destination (Join-Path $targetRuntime $entry.name)
  }
  Copy-Item -LiteralPath $sourceModel -Destination $targetModel
  Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $assetRoot 'manifests\llama-b10760-win-vulkan-x64.manifest.json')
  $llamaLicense = Join-Path $sourceRoot 'downloads\LICENSE-llama.cpp-b10760'
  if (Test-Path -LiteralPath $llamaLicense -PathType Leaf) {
    Copy-Item -LiteralPath $llamaLicense -Destination (Join-Path $assetRoot 'licenses\LICENSE-llama.cpp-b10760')
  }
}

Test-Inventory $targetRuntime $targetModel
[ordered]@{
  assetRoot = $targetResolved
  runtimePath = $targetRuntime
  modelPath = $targetModel
  runtimeRelease = $manifest.release
  runtimeCommit = $manifest.commit
  runtimeFiles = $manifest.files.Count
  modelSha256 = $modelSha256
  productionOverlap = $false
} | ConvertTo-Json
