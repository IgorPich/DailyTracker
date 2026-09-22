param(
  [Parameter(Mandatory = $true)][string]$SourceRoot,
  [Parameter(Mandatory = $true)][string]$LlamaCppRoot,
  [Parameter(Mandatory = $true)][string]$QuantizerPath,
  [Parameter(Mandatory = $true)][string]$PythonPath,
  [Parameter(Mandatory = $true)][string]$OutputRoot
)

$ErrorActionPreference = 'Stop'
$expectedSourceRevision = '2fe192450127e6a83f7441aef6e3ca586c338b77'
$expectedLlamaRevision = '0f3a71be15af836d277c9f918adfafb45732677e'
$expectedConverterSha256 = '21b70f59d9cfa5f3963bfe9b1c648c16b1fdeca9cff67778bf776d1137b267b5'
$expectedQuantizerSha256 = 'abde9c543104ba064354eab6acafb1f02fbe704cddb5f81591bcee42250bf372'
$expectedQuantizerImplSha256 = '62fa3ba3884f7195d99d668b83f68c57fd3bd97646b16b7409405b66842a8f14'
$expectedF16Sha256 = 'dfb7f35ff9b60e406728c99bf6247454ebe51218766371e9381a995547cffba3'
$expectedQ4Sha256 = '3913ce8d702ec0cb053c2c5238c4438596f2da99ecab56480e252f20580673db'

function Get-NormalizedHash([string]$Path) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing file: $Path" }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-Hash([string]$Path, [string]$Expected) {
  $actual = Get-NormalizedHash $Path
  if ($actual -ne $Expected) { throw "SHA-256 mismatch for $Path. Expected $Expected, got $actual" }
}

function Get-ExactRevision([string]$RepositoryRoot) {
  $safeRoot = ([IO.Path]::GetFullPath($RepositoryRoot)).Replace('\', '/')
  $revision = & git -c "safe.directory=$safeRoot" -C $RepositoryRoot rev-parse HEAD
  if ($LASTEXITCODE -ne 0) { throw "Unable to resolve Git revision for $RepositoryRoot" }
  return $revision.Trim()
}

$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$LlamaCppRoot = [IO.Path]::GetFullPath($LlamaCppRoot)
$QuantizerPath = [IO.Path]::GetFullPath($QuantizerPath)
$PythonPath = [IO.Path]::GetFullPath($PythonPath)
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)

if (!(Test-Path -LiteralPath $SourceRoot -PathType Container)) { throw "Missing source root: $SourceRoot" }
if (!(Test-Path -LiteralPath $LlamaCppRoot -PathType Container)) { throw "Missing llama.cpp root: $LlamaCppRoot" }
if (!(Test-Path -LiteralPath $PythonPath -PathType Leaf)) { throw "Missing Python executable: $PythonPath" }
if ($OutputRoot -eq $SourceRoot -or $OutputRoot -eq $LlamaCppRoot) { throw 'OutputRoot must be separate from both source repositories' }

$manifestPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\legal\companion-model\provenance.json'))
$requirementsPath = Join-Path $PSScriptRoot 'requirements-phi35-b10760.txt'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

if ((Get-ExactRevision $SourceRoot) -ne $expectedSourceRevision) { throw 'Microsoft source revision mismatch' }
foreach ($file in $manifest.source.files) {
  $sourcePath = Join-Path $SourceRoot $file.path
  if ((Get-Item -LiteralPath $sourcePath).Length -ne [long]$file.bytes) { throw "Size mismatch for $($file.path)" }
  Assert-Hash $sourcePath $file.sha256
}

if ((Get-ExactRevision $LlamaCppRoot) -ne $expectedLlamaRevision) { throw 'llama.cpp revision mismatch' }
$converterPath = Join-Path $LlamaCppRoot 'convert_hf_to_gguf.py'
Assert-Hash $converterPath $expectedConverterSha256
Assert-Hash $QuantizerPath $expectedQuantizerSha256
$quantizerImplPath = Join-Path (Split-Path -Parent $QuantizerPath) 'llama-quantize-impl.dll'
Assert-Hash $quantizerImplPath $expectedQuantizerImplSha256

$pythonVersion = (& $PythonPath --version 2>&1).ToString().Trim()
if ($LASTEXITCODE -ne 0 -or $pythonVersion -ne 'Python 3.12.10') { throw "Expected Python 3.12.10, got $pythonVersion" }
$expectedPackages = Get-Content -LiteralPath $requirementsPath |
  Where-Object { $_ -and !$_.StartsWith('--') -and !$_.StartsWith('#') } |
  ForEach-Object { $_.Trim().ToLowerInvariant() } |
  Sort-Object
$actualPackages = & $PythonPath -m pip freeze
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect Python environment' }
$actualPackages = $actualPackages | ForEach-Object { $_.Trim().ToLowerInvariant() } | Sort-Object
$dependencyDifference = Compare-Object $expectedPackages $actualPackages
if ($dependencyDifference) {
  throw "Python dependency lock mismatch:`n$($dependencyDifference | Out-String)"
}

New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$f16Path = Join-Path $OutputRoot 'Phi-3.5-mini-instruct-2fe19245-F16.gguf'
$q4Path = Join-Path $OutputRoot 'Phi-3.5-mini-instruct-2fe19245-Q4_0.gguf'
foreach ($path in @($f16Path, $q4Path)) {
  if (Test-Path -LiteralPath $path) { throw "Refusing to overwrite existing output: $path" }
}

& $PythonPath $converterPath $SourceRoot --outfile $f16Path --outtype f16
if ($LASTEXITCODE -ne 0) { throw "F16 conversion failed with exit code $LASTEXITCODE" }
Assert-Hash $f16Path $expectedF16Sha256

& $QuantizerPath $f16Path $q4Path Q4_0
if ($LASTEXITCODE -ne 0) { throw "Q4_0 quantization failed with exit code $LASTEXITCODE" }
Assert-Hash $q4Path $expectedQ4Sha256

$result = [ordered]@{
  sourceRevision = $expectedSourceRevision
  llamaCppRevision = $expectedLlamaRevision
  pythonVersion = $pythonVersion
  f16 = [ordered]@{
    filename = [IO.Path]::GetFileName($f16Path)
    bytes = (Get-Item -LiteralPath $f16Path).Length
    sha256 = Get-NormalizedHash $f16Path
  }
  q4_0 = [ordered]@{
    filename = [IO.Path]::GetFileName($q4Path)
    bytes = (Get-Item -LiteralPath $q4Path).Length
    sha256 = Get-NormalizedHash $q4Path
  }
}
$result | ConvertTo-Json -Depth 5
