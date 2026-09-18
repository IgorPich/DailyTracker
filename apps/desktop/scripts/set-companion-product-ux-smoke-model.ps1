param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Missing', 'Restore')]
  [string]$State
)
$ErrorActionPreference = 'Stop'
$assetRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'GreekGodDev\companion-product-ux-smoke-assets'))
$productionRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'com.igorpich.formlog\companion-managed-runtime'))
$model = Join-Path $assetRoot 'models\Phi-3.5-mini-instruct-Q4_0.gguf'
$held = "$model.missing-smoke"
$expectedHash = 'b5374915da534cb93df39f03bd4f2cd5a0c533df0d5e21957dc9556c260be9eb'
if ($assetRoot -eq $productionRoot -or $assetRoot.StartsWith("$productionRoot\", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Smoke model path overlaps production managed assets.'
}
$managed = @(Get-CimInstance Win32_Process -Filter "name='llama-server.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine.IndexOf($assetRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
})
if ($managed.Count) { throw 'Stop or wait for the isolated managed sidecar before changing the smoke model state.' }

if ($State -eq 'Missing') {
  if (-not (Test-Path -LiteralPath $model -PathType Leaf) -or (Test-Path -LiteralPath $held)) { throw 'Smoke model is not in the exact restorable state.' }
  if ((Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Refusing to move a checksum-mismatched model.' }
  Move-Item -LiteralPath $model -Destination $held
  Write-Output 'Isolated smoke model is now intentionally missing. Production assets were not touched.'
} else {
  if ((Test-Path -LiteralPath $model) -or -not (Test-Path -LiteralPath $held -PathType Leaf)) { throw 'Smoke model cannot be restored from the expected held path.' }
  Move-Item -LiteralPath $held -Destination $model
  if ((Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Restored smoke model checksum mismatch.' }
  Write-Output 'Isolated smoke model restored and checksum verified.'
}
