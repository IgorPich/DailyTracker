Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

function Get-KitRoot {
  return [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}

function Get-EvidenceDirectory {
  $directory = Join-Path (Get-KitRoot) 'evidence'
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
  }
  return $directory
}

function Write-SafeJson([string]$Name, [object]$Value) {
  $path = Join-Path (Get-EvidenceDirectory) $Name
  $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $path -Encoding UTF8
  return $path
}

function Read-Json([string]$Path) {
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Get-NativeContract {
  return Read-Json (Join-Path (Get-KitRoot) 'contracts\greekgod-windows-native-runtime.json')
}

function Get-AiContract {
  return Read-Json (Join-Path (Get-KitRoot) 'contracts\greekgod-ai-pack-4.0.json')
}

function Get-KitManifest {
  return Read-Json (Join-Path (Get-KitRoot) 'kit-manifest.json')
}

function Test-SamePath([string]$Left, [string]$Right) {
  if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
  $leftFull = [IO.Path]::GetFullPath($Left).TrimEnd('\')
  $rightFull = [IO.Path]::GetFullPath($Right).TrimEnd('\')
  return $leftFull.Equals($rightFull, [StringComparison]::OrdinalIgnoreCase)
}

function Get-ManagedRoots {
  return @(
    (Join-Path $env:LOCALAPPDATA 'com.igorpich.formlog\companion-managed-runtime'),
    (Join-Path $env:APPDATA 'com.igorpich.formlog\companion-managed-runtime')
  ) | Select-Object -Unique
}

function Get-ActiveRuntimeDirectory {
  foreach ($root in Get-ManagedRoots) {
    $pointerPath = Join-Path $root 'active-pack.json'
    if (-not (Test-Path -LiteralPath $pointerPath -PathType Leaf)) { continue }
    $pointer = Read-Json $pointerPath
    if ($pointer.formatVersion -ne 1 -or $pointer.directory -notmatch '^install-[0-9a-fA-F]{32}$') {
      throw 'ACTIVE_PACK_INVALID: active-pack.json is not trusted.'
    }
    return Join-Path (Join-Path (Join-Path $root 'packs') $pointer.directory) 'runtime'
  }
  throw 'ACTIVE_PACK_MISSING: no production AI Pack pointer exists.'
}

function Get-SafeFileEvidence([string]$Path, [string]$Origin) {
  $file = Get-Item -LiteralPath $Path
  return [ordered]@{
    origin = $Origin
    fileVersion = $file.VersionInfo.FileVersion
    bytes = $file.Length
    sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
