Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:StableSha256 = 'F040143048C67B558AB126D4403DACFE2A3873F9860FF38558FB024D254FBEC9'
$script:Phase6Sha256 = '6E2FD4129A4672A5414C2920F4D795410FA1C0E8BBB7D2B5EE5D995F40236CFB'
$script:Phase6Bytes = 6698493
$script:ProductAppDataName = 'com.igorpich.formlog'
$script:TaskName = 'GreekGod Sync Service'
$script:FirewallPrefix = 'GreekGod Sync Service'
$script:MarkerName = '.greekgod-phase6-validation.json'

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

function Invoke-ReadOnlyDatabaseCommand(
  [string]$Verifier,
  [string]$Command,
  [string]$Database,
  [string[]]$ArgumentsAfterDatabase,
  [string]$Label
) {
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('greekgod-db-audit-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempDirectory | Out-Null
  try {
    $copy = Join-Path $tempDirectory 'greekgod-v3.sqlite'
    Copy-Item -LiteralPath $Database -Destination $copy
    Invoke-StrictNative $Verifier (@($Command,$copy) + $ArgumentsAfterDatabase) $Label
  } finally {
    if (Test-Path -LiteralPath $tempDirectory) {
      $resolved = (Resolve-Path -LiteralPath $tempDirectory).Path
      if (-not $resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe temporary cleanup target: $resolved" }
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }
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
  $markerPath = Join-Path $AppDataPath $script:MarkerName
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { return $null }
  return Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
}

function Assert-DisposableAcknowledgement([bool]$Acknowledged) {
  if (-not $Acknowledged) {
    throw 'Pass -AcknowledgeDisposableEnvironment only inside a disposable Windows environment.'
  }
}

function Get-SystemIntegration([string]$KitRoot) {
  $paths = Get-TargetPaths $KitRoot
  $processes = @(Get-ProductProcesses)
  $task = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
  $rules = @(Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object {
    ([string]$_.Name).IndexOf($script:FirewallPrefix, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
  $service = Join-Path $paths.Install 'greekgod-sync-service.exe'
  $taskMatches = $false
  if ($null -ne $task) {
    $actions = @($task.Actions)
    $taskMatches = $actions.Count -eq 1 -and ([string]$actions[0].Execute).Equals($service, [StringComparison]::OrdinalIgnoreCase)
  }
  $firewallMatches = $true
  foreach ($rule in $rules) {
    $filter = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule -ErrorAction Stop
    if (-not ([string]$filter.Program).Equals($service, [StringComparison]::OrdinalIgnoreCase)) { $firewallMatches = $false }
  }
  $version = $null
  $exe = Join-Path $paths.Install 'greekgod.exe'
  if (Test-Path -LiteralPath $exe -PathType Leaf) { $version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion }
  return [pscustomobject]@{
    installPresent = Test-Path -LiteralPath $paths.Install -PathType Container
    productVersion = $version
    installPath = '%LOCALAPPDATA%\GreekGod'
    appDataPresent = Test-Path -LiteralPath $paths.AppData -PathType Container
    processCount = $processes.Count
    taskCount = if ($null -eq $task) { 0 } else { 1 }
    taskTargetsCurrentService = $taskMatches
    firewallRuleCount = $rules.Count
    firewallRulesTargetCurrentService = $firewallMatches
  }
}

function Write-JsonFile([string]$Path, [object]$Value) {
  $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}
