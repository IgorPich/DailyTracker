param(
  [ValidateSet('Clean','SeededData','StableInstalled','Rc1Installed')][string]$Stage = 'Clean',
  [switch]$AcknowledgeDisposableEnvironment
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
if (-not $AcknowledgeDisposableEnvironment) { throw 'Pass -AcknowledgeDisposableEnvironment only inside the disposable rehearsal environment.' }
$kit = Split-Path $PSScriptRoot -Parent
$paths = Get-TargetPaths $kit
$config = $paths.Config
if ($env:COMPUTERNAME -eq $config.sourceMachine -and $env:USERNAME -eq $config.sourceUser) {
  throw 'This is the kit builder machine/user. Use a disposable Windows machine or a dedicated different Windows user.'
}
if (-not [Environment]::Is64BitOperatingSystem) { throw 'The rehearsal requires 64-bit Windows.' }
$drive = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + ([IO.Path]::GetPathRoot($env:LOCALAPPDATA).TrimEnd('\')) + "'")
if ($null -eq $drive -or $drive.FreeSpace -lt 5GB) { throw 'At least 5 GB free space is required.' }
Assert-FileHash (Join-Path $kit $config.stableInstaller) $script:StableSha256
Assert-FileHash (Join-Path $kit $config.rc1Installer) $script:Rc1Sha256
Assert-FileHash (Join-Path $kit 'data\expectations.json') ([string]$config.expectationsSha256)
Assert-FileHash (Join-Path $kit 'data\rehearsal-data-manifest.json') ([string]$config.dataManifestSha256)
$processes = @(Get-ProductProcesses)
$task = Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
$rules = @(Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { ([string]$_.Name).IndexOf($script:FirewallPrefix, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
$marker = Get-RehearsalMarker $paths.AppData
$exe = Join-Path $paths.Install 'greekgod.exe'

if ($Stage -eq 'Clean') {
  if ((Test-Path -LiteralPath $paths.Install) -or (Test-Path -LiteralPath $paths.AppData) -or $null -ne $task -or $rules.Count -ne 0 -or $processes.Count -ne 0) {
    throw 'Clean preflight failed: installation, AppData, scheduled task, or firewall rule already exists.'
  }
} else {
  if ($null -eq $marker -or $marker.classification -ne 'SANITIZED_REHEARSAL_COPY') { throw 'Isolated rehearsal marker is missing or invalid.' }
  if ($Stage -eq 'SeededData') {
    if ((Test-Path -LiteralPath $paths.Install) -or $null -ne $task -or $rules.Count -ne 0 -or $processes.Count -ne 0) { throw 'SeededData stage must precede installation and have no GreekGod system integration.' }
    $dataManifest = Get-Content -LiteralPath (Join-Path $kit 'data\rehearsal-data-manifest.json') -Raw | ConvertFrom-Json
    Assert-FileHash $paths.Database ([string]$dataManifest.databaseSha256)
    Invoke-StrictNative (Join-Path $kit 'bin\greekgod-upgrade-rehearsal-verifier.exe') @('audit-seed',$paths.Database,(Join-Path $kit 'data\expectations.json')) 'Seeded data audit'
  }
  if ($Stage -eq 'StableInstalled' -or $Stage -eq 'Rc1Installed') {
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Installed executable is missing: $exe" }
    $version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
    $expected = if ($Stage -eq 'StableInstalled') { '3.0.3' } else { '4.0.0-rc.1' }
    if ($version -ne $expected) { throw "Expected installed version $expected, found $version" }
    if ($null -eq $task) { throw 'Expected GreekGod Sync Service scheduled task is missing.' }
    if ($rules.Count -eq 0) { throw 'Expected GreekGod Sync Service firewall rules are missing.' }
    $service = Join-Path $paths.Install 'greekgod-sync-service.exe'
    $taskActions = @($task.Actions)
    if ($taskActions.Count -ne 1 -or -not ([string]$taskActions[0].Execute).Equals($service, [StringComparison]::OrdinalIgnoreCase)) { throw 'Scheduled task does not target the isolated installation.' }
    foreach ($rule in $rules) {
      $filter = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule -ErrorAction Stop
      if (-not ([string]$filter.Program).Equals($service, [StringComparison]::OrdinalIgnoreCase)) { throw 'Firewall rule does not target the isolated installation.' }
    }
    $unexpected = @($processes | Where-Object {
      $path = [string]$_.ExecutablePath
      $command = [string]$_.CommandLine
      if (([string]$_.Name).Equals('greekgod.exe', [StringComparison]::OrdinalIgnoreCase)) { return -not $path.Equals($exe, [StringComparison]::OrdinalIgnoreCase) }
      return -not ($path.Equals($service, [StringComparison]::OrdinalIgnoreCase) -and $command.IndexOf($paths.Database, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
    if ($unexpected.Count -ne 0) { throw 'A GreekGod process does not belong to the isolated installation/data path.' }
  }
}
Write-Host ("PASS preflight: stage={0}; OS={1}; x64=True; freeGB={2:N1}; install={3}; appData={4}; seedSHA256={5}" -f $Stage,[Environment]::OSVersion.Version,($drive.FreeSpace/1GB),$paths.Install,$paths.AppData,$config.seedDatabaseSha256)
