Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:StableSha256 = 'F040143048C67B558AB126D4403DACFE2A3873F9860FF38558FB024D254FBEC9'
$script:Rc1Sha256 = '934725CFFAF670FA5A78A725AE6AB9467880B1708CAB4688ABD3AE282D52DBF8'
$script:ProductAppDataName = 'com.igorpich.formlog'
$script:TaskName = 'GreekGod Sync Service'
$script:FirewallPrefix = 'GreekGod Sync Service'

function Assert-FileHash([string]$Path, [string]$Expected) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required file is missing: $Path" }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actual -ne $Expected.ToUpperInvariant()) { throw "SHA-256 mismatch for $Path. Expected $Expected, found $actual." }
}

function Assert-PathOutside([string]$Candidate, [string]$Forbidden, [string]$Label) {
  $candidateFull = [IO.Path]::GetFullPath($Candidate).TrimEnd('\')
  $forbiddenFull = [IO.Path]::GetFullPath($Forbidden).TrimEnd('\')
  if ($candidateFull.Equals($forbiddenFull, [StringComparison]::OrdinalIgnoreCase) -or
      $candidateFull.StartsWith($forbiddenFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label must be outside protected path $forbiddenFull"
  }
}

function Invoke-StrictNative([string]$FilePath, [string[]]$Arguments, [string]$Label) {
  $quoted = @($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $FilePath
  $start.Arguments = $quoted
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  if (-not $process.Start()) { throw "$Label did not start." }
  $outText = $process.StandardOutput.ReadToEnd()
  $errText = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($outText) { [Console]::Out.Write($outText) }
  if ($errText) { [Console]::Error.Write($errText) }
  if ($process.ExitCode -ne 0) { throw "$Label failed with exit code $($process.ExitCode)." }
}

function Read-KitConfig([string]$KitRoot) {
  $path = Join-Path $KitRoot 'kit-config.json'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Kit configuration is missing: $path" }
  return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Get-TargetPaths([string]$KitRoot) {
  $config = Read-KitConfig $KitRoot
  return [pscustomobject]@{
    Config = $config
    AppData = Join-Path $env:APPDATA $script:ProductAppDataName
    Database = Join-Path (Join-Path $env:APPDATA $script:ProductAppDataName) 'greekgod-v3.sqlite'
    Install = Join-Path $env:LOCALAPPDATA 'GreekGod'
    Evidence = Join-Path $KitRoot 'evidence'
  }
}

function Get-ProductProcesses {
  return @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $name = [string]$_.Name
    $name.Equals('greekgod.exe', [StringComparison]::OrdinalIgnoreCase) -or
    $name.Equals('greekgod-sync-service.exe', [StringComparison]::OrdinalIgnoreCase)
  })
}

function Assert-NoProductProcess {
  $matches = @(Get-ProductProcesses)
  if ($matches.Count -ne 0) { throw 'GreekGod/Sync Service must be closed before this step.' }
}

function Assert-AppClosed {
  $matches = @(Get-ProductProcesses | Where-Object { ([string]$_.Name).Equals('greekgod.exe', [StringComparison]::OrdinalIgnoreCase) })
  if ($matches.Count -ne 0) { throw 'GreekGod must be closed before capture.' }
}

function Get-RehearsalMarker([string]$AppDataPath) {
  $markerPath = Join-Path $AppDataPath '.greekgod-upgrade-rehearsal.json'
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { return $null }
  return Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
}
