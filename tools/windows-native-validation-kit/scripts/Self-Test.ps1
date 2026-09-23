[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'NativeValidation.Common.ps1')
$scripts = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1' -File)
foreach ($script in $scripts) {
  [void][scriptblock]::Create((Get-Content -LiteralPath $script.FullName -Raw))
}
$manifest = Get-KitManifest
$installer = Join-Path (Get-KitRoot) ('installer\' + $manifest.installer.fileName)
$item = Get-Item -LiteralPath $installer
if ($item.Length -ne $manifest.installer.bytes -or (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.installer.sha256) { throw 'INSTALLER_HASH_MISMATCH' }
$pack = & (Join-Path $PSScriptRoot 'Test-AiPack.ps1') -NoEvidence
if ($pack.result -ne 'PASS' -or $pack.trustedPayloadFiles -ne 33) { throw 'AI_PACK_SELF_TEST_FAILED' }
Write-Output "PASS portable kit self-test: $($scripts.Count) PS5.1-compatible scripts, installer pinned, AI Pack 33/33"
