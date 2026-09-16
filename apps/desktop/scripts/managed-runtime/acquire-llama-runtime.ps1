param([Parameter(Mandatory=$true)][string]$DestinationRoot)
$ErrorActionPreference = 'Stop'
$release = 'b10760'
$commit = '0f3a71be15af836d277c9f918adfafb45732677e'
$archiveName = 'llama-b10760-bin-win-vulkan-x64.zip'
$archiveSha256 = '34dfb5aab953a1e69faf0fc185edda10ff08e515f5607f7b8cdda740b1ed88cb'
$manifestPath = Join-Path $PSScriptRoot 'llama-b10760-win-vulkan-x64.manifest.json'
$downloads = Join-Path $DestinationRoot 'downloads'
$runtime = Join-Path $DestinationRoot 'runtime\llama.cpp-b10760'
$staging = Join-Path $DestinationRoot 'staging\llama.cpp-b10760'
$archive = Join-Path $downloads $archiveName
New-Item -ItemType Directory -Force -Path $downloads | Out-Null
if (!(Test-Path -LiteralPath $archive)) {
  Invoke-WebRequest -Uri "https://github.com/ggml-org/llama.cpp/releases/download/$release/$archiveName" -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archiveSha256) { throw 'Pinned runtime archive checksum mismatch' }
$license = Join-Path $downloads 'LICENSE-llama.cpp-b10760'
if (!(Test-Path -LiteralPath $license)) { Invoke-WebRequest -Uri "https://raw.githubusercontent.com/ggml-org/llama.cpp/$commit/LICENSE" -OutFile $license }
if ((Get-FileHash -LiteralPath $license -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'e562a2ddfaf8280537795ac5ecd34e3012b6582a147ef69ba6a6a5c08c84757d') { throw 'Pinned llama.cpp license checksum mismatch' }
if (Test-Path -LiteralPath $runtime) { throw "Refusing to replace existing runtime: $runtime" }
if (Test-Path -LiteralPath $staging) { throw "Refusing to replace existing staging directory: $staging" }
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $staging
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
foreach ($expected in $manifest.files) {
  $source = Join-Path $staging $expected.name
  if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "Archive is missing required runtime file: $($expected.name)" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $runtime $expected.name)
}
$actual = Get-ChildItem -LiteralPath $runtime -File
if ($actual.Count -ne $manifest.files.Count) { throw 'Runtime file inventory count mismatch' }
foreach ($expected in $manifest.files) {
  $path = Join-Path $runtime $expected.name
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing runtime file: $($expected.name)" }
  $file = Get-Item -LiteralPath $path
  if ($file.Length -ne $expected.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected.sha256) { throw "Runtime inventory mismatch: $($expected.name)" }
}
Write-Output "Verified llama.cpp $release at $runtime. Model installation is intentionally separate and manual."
