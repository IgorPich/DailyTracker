[CmdletBinding()]
param(
  [string]$PackPath = (Join-Path (Join-Path $PSScriptRoot '..') 'ai-pack'),
  [switch]$NoEvidence
)

. (Join-Path $PSScriptRoot 'NativeValidation.Common.ps1')

$packRoot = [IO.Path]::GetFullPath($PackPath)
$aiContractPath = Join-Path (Get-KitRoot) 'contracts\greekgod-ai-pack-4.0.json'
$manifestPath = Join-Path $packRoot 'manifest.json'
if (-not (Test-Path -LiteralPath $packRoot -PathType Container)) { throw 'PACK_MISSING' }
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'MANIFEST_MISSING' }
$manifestContract = Read-Json $manifestPath
$authorityContract = Read-Json $aiContractPath
if (($manifestContract | ConvertTo-Json -Depth 20 -Compress) -ne ($authorityContract | ConvertTo-Json -Depth 20 -Compress)) {
  throw 'PACK_CONTRACT_MISMATCH'
}

$contract = $authorityContract
$native = Get-NativeContract
if ($contract.windowsNativeRuntimeSet -ne $native.contractId) { throw 'NATIVE_RUNTIME_CONTRACT_MISMATCH' }
$expected = New-Object System.Collections.Generic.List[object]
$expected.Add([pscustomobject]@{ path=$contract.model.relativePath; bytes=$contract.model.bytes; sha256=$contract.model.sha256; kind='MODEL' })
foreach ($file in @($contract.runtime.files)) {
  $expected.Add([pscustomobject]@{ path=($contract.runtime.relativePath + '/' + $file.relativePath); bytes=$file.bytes; sha256=$file.sha256; kind='RUNTIME' })
}
foreach ($name in @($native.aiPackFiles)) {
  $file = @($native.files | Where-Object { $_.name -eq $name })
  if ($file.Count -ne 1 -or $file[0].architecture -ne 'x64') { throw "NATIVE_RUNTIME_CONTRACT_INVALID: $name" }
  $expected.Add([pscustomobject]@{ path=($contract.runtime.relativePath + '/' + $name); bytes=$file[0].bytes; sha256=$file[0].sha256; kind='NATIVE_PREREQUISITE' })
}
foreach ($file in @($contract.requiredFiles)) {
  $expected.Add([pscustomobject]@{ path=$file.relativePath; bytes=$file.bytes; sha256=$file.sha256; kind=$file.kind })
}

$allowed = @{}
foreach ($file in $expected) {
  $key = $file.path.ToLowerInvariant()
  if ($allowed.ContainsKey($key)) { throw "DUPLICATE_PATH: $($file.path)" }
  $allowed[$key] = $true
  $path = Join-Path $packRoot ($file.path -replace '/', '\')
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$($file.kind)_MISSING: $($file.path)" }
  $item = Get-Item -LiteralPath $path
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "UNSAFE_REPARSE_POINT: $($file.path)" }
  if ($item.Length -ne $file.bytes) { throw "$($file.kind)_INVALID_SIZE: $($file.path)" }
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "$($file.kind)_INVALID_HASH: $($file.path)" }
}

$actual = @(Get-ChildItem -LiteralPath $packRoot -File -Recurse | ForEach-Object {
  $_.FullName.Substring($packRoot.Length).TrimStart('\').Replace('\','/')
})
foreach ($path in $actual) {
  if ($path -eq 'manifest.json') { continue }
  if (-not $allowed.ContainsKey($path.ToLowerInvariant())) { throw "UNEXPECTED_FILE: $path" }
}
if ($actual.Count -ne ($expected.Count + 1)) { throw 'PACK_FILE_COUNT_MISMATCH' }

$result = [ordered]@{ result='PASS'; trustedPayloadFiles=$expected.Count; packId=$contract.packId; packVersion=$contract.packVersion; modelSha256=$contract.model.sha256; nativeRuntimeSet=$contract.windowsNativeRuntimeSet }
if (-not $NoEvidence) { Write-SafeJson 'ai-pack-verification.json' $result | Out-Null }
$result
