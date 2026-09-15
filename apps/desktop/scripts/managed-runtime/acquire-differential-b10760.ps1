param([Parameter(Mandatory = $true)][string]$DestinationRoot)
$ErrorActionPreference = 'Stop'
$release = 'b10760'
$commit = '0f3a71be15af836d277c9f918adfafb45732677e'
$archiveName = 'llama-b10760-bin-win-vulkan-x64.zip'
$archiveSha256 = '34dfb5aab953a1e69faf0fc185edda10ff08e515f5607f7b8cdda740b1ed88cb'
$archive = Join-Path $DestinationRoot $archiveName
$runtime = Join-Path $DestinationRoot 'runtime'

New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
  Invoke-WebRequest -UseBasicParsing "https://github.com/ggml-org/llama.cpp/releases/download/$release/$archiveName" -OutFile $archive
}
$actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $archiveSha256) { throw "Pinned archive checksum mismatch: $actual" }
if (Test-Path -LiteralPath $runtime) { throw "Refusing to overwrite existing differential runtime: $runtime" }
Expand-Archive -LiteralPath $archive -DestinationPath $runtime
$version = & (Join-Path $runtime 'llama-server.exe') --version
if ($LASTEXITCODE -ne 0 -or "$version" -notmatch 'build 10760' -or "$version" -notmatch '0f3a71be1') {
  throw "Unexpected differential runtime; expected $release at $commit"
}
Write-Host "Staged $release ($commit) at $runtime. No model was downloaded."
