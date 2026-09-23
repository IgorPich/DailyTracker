[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$AiPack,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3
$sourceRoot = $PSScriptRoot
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $sourceRoot '..\..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
if ($output.StartsWith($repositoryRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Output directory must be outside the repository.' }
if (Test-Path -LiteralPath $output) { throw "Output already exists: $output" }
$contract = Get-Content -LiteralPath (Join-Path $sourceRoot 'validation-kit-contract.json') -Raw | ConvertFrom-Json
$installerPath = [IO.Path]::GetFullPath($Installer)
$packPath = [IO.Path]::GetFullPath($AiPack)
$installerFile = Get-Item -LiteralPath $installerPath
if ($installerFile.Name -ne $contract.installer.fileName -or $installerFile.Length -ne $contract.installer.bytes -or (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $contract.installer.sha256) {
  throw 'Installer does not match the approved validation-kit contract.'
}
$nodeVerifier = Join-Path $repositoryRoot 'apps\desktop\scripts\managed-runtime\ai-pack-tool.mjs'
& node $nodeVerifier verify --pack $packPath
if ($LASTEXITCODE -ne 0) { throw 'Approved AI Pack verifier failed.' }

New-Item -ItemType Directory -Path $output | Out-Null
try {
  foreach ($directory in @('installer','ai-pack','contracts','scripts','evidence')) { New-Item -ItemType Directory -Path (Join-Path $output $directory) | Out-Null }
  Copy-Item -LiteralPath $installerPath -Destination (Join-Path $output ('installer\' + $contract.installer.fileName))
  Copy-Item -Path (Join-Path $packPath '*') -Destination (Join-Path $output 'ai-pack') -Recurse
  Copy-Item -LiteralPath (Join-Path $repositoryRoot 'apps\desktop\src-tauri\ai-pack\greekgod-ai-pack-4.0.json') -Destination (Join-Path $output 'contracts\greekgod-ai-pack-4.0.json')
  Copy-Item -LiteralPath (Join-Path $repositoryRoot 'apps\desktop\src-tauri\windows-native-runtime\greekgod-windows-native-runtime.json') -Destination (Join-Path $output 'contracts\greekgod-windows-native-runtime.json')
  Copy-Item -Path (Join-Path $sourceRoot 'scripts\*') -Destination (Join-Path $output 'scripts')
  Copy-Item -LiteralPath (Join-Path $sourceRoot 'README.md') -Destination (Join-Path $output 'README.md')
  Copy-Item -Path (Join-Path $sourceRoot '*.cmd') -Destination $output
  $manifest = [ordered]@{
    formatVersion=1
    kitId=$contract.kitId
    platform=$contract.platform
    installer=[ordered]@{ fileName=$contract.installer.fileName; bytes=$contract.installer.bytes; sha256=$contract.installer.sha256 }
    aiPack=[ordered]@{ directoryName='ai-pack'; packId=$contract.aiPack.packId; packVersion=$contract.aiPack.packVersion; trustedPayloadFiles=$contract.aiPack.trustedPayloadFiles; modelSha256=$contract.aiPack.modelSha256; windowsNativeRuntimeSet=$contract.aiPack.windowsNativeRuntimeSet }
    contracts=[ordered]@{
      aiPackSha256=(Get-FileHash -LiteralPath (Join-Path $output 'contracts\greekgod-ai-pack-4.0.json') -Algorithm SHA256).Hash.ToLowerInvariant()
      nativeRuntimeSha256=(Get-FileHash -LiteralPath (Join-Path $output 'contracts\greekgod-windows-native-runtime.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output 'kit-manifest.json') -Encoding UTF8
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $output 'scripts\Self-Test.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Portable kit self-test failed.' }
} catch {
  throw "KIT_BUILD_FAILED (partial output preserved for inspection): $($_.Exception.Message)"
}
Write-Output "PASS portable validation kit: $output"
