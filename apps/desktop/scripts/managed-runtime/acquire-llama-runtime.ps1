param([Parameter(Mandatory=$true)][string]$DestinationRoot)
$ErrorActionPreference = 'Stop'
$release = 'b7081'
$archiveName = 'llama-b7081-bin-win-vulkan-x64.zip'
$archiveSha256 = 'c239fcca8c80d4211a64a0fd16214f8d0893bf414fe4c1c3fa2c4be5918bf016'
$manifestPath = Join-Path $PSScriptRoot 'llama-b7081-win-vulkan-x64.manifest.json'
$downloads = Join-Path $DestinationRoot 'downloads'
$runtime = Join-Path $DestinationRoot 'runtime\llama.cpp-b7081'
$archive = Join-Path $downloads $archiveName
New-Item -ItemType Directory -Force -Path $downloads | Out-Null
if (!(Test-Path -LiteralPath $archive)) {
  Invoke-WebRequest -Uri "https://github.com/ggml-org/llama.cpp/releases/download/$release/$archiveName" -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archiveSha256) { throw 'Pinned runtime archive checksum mismatch' }
$license = Join-Path $downloads 'LICENSE-llama.cpp-b7081'
if (!(Test-Path -LiteralPath $license)) { Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ggml-org/llama.cpp/80deff3648b93727422461c41c7279ef1dac7452/LICENSE' -OutFile $license }
if ((Get-FileHash -LiteralPath $license -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'e562a2ddfaf8280537795ac5ecd34e3012b6582a147ef69ba6a6a5c08c84757d') { throw 'Pinned llama.cpp license checksum mismatch' }
if (Test-Path -LiteralPath $runtime) { throw "Refusing to replace existing runtime: $runtime" }
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $runtime
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$actual = Get-ChildItem -LiteralPath $runtime -File
if ($actual.Count -ne $manifest.files.Count) { throw 'Runtime file inventory count mismatch' }
foreach ($expected in $manifest.files) {
  $path = Join-Path $runtime $expected.name
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing runtime file: $($expected.name)" }
  $file = Get-Item -LiteralPath $path
  if ($file.Length -ne $expected.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected.sha256) { throw "Runtime inventory mismatch: $($expected.name)" }
}
Write-Output "Verified llama.cpp $release at $runtime. Model installation is intentionally separate and manual."
