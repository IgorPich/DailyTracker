param(
  [ValidateSet('Clean','SeededData','FreshInstalled','StableInstalled','FinalInstalled','Uninstalled')]
  [string]$Stage = 'Clean',
  [switch]$AcknowledgeDisposableEnvironment
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-DisposableAcknowledgement $AcknowledgeDisposableEnvironment.IsPresent
$kit = Split-Path $PSScriptRoot -Parent
$paths = Get-TargetPaths $kit
$config = $paths.Config

$os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
if ([string]$os.Caption -notmatch 'Windows (10|11)' -or -not [Environment]::Is64BitOperatingSystem) {
  throw 'Physical validation requires Windows 10 or 11 x64.'
}
$driveId = [IO.Path]::GetPathRoot($env:LOCALAPPDATA).TrimEnd('\')
$drive = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $driveId + "'")
if ($null -eq $drive -or $drive.FreeSpace -lt 5GB) { throw 'At least 5 GB free space is required.' }

Assert-FileHash (Join-Path $kit $config.stableInstaller) $script:StableSha256
Assert-FileHash (Join-Path $kit $config.finalInstaller) $script:FinalSha256
if ((Get-Item -LiteralPath (Join-Path $kit $config.finalInstaller)).Length -ne $script:FinalBytes) {
  throw 'Final installer size mismatch.'
}
Assert-FileHash (Join-Path $kit 'data\expectations.json') ([string]$config.expectationsSha256)
Assert-FileHash (Join-Path $kit 'data\rehearsal-data-manifest.json') ([string]$config.dataManifestSha256)

$system = Get-SystemIntegration $kit
$marker = Get-RehearsalMarker $paths.AppData

if ($Stage -eq 'Clean') {
  if ($system.installPresent -or $system.appDataPresent -or $system.taskCount -ne 0 -or
      $system.firewallRuleCount -ne 0 -or $system.processCount -ne 0) {
    throw 'Clean preflight failed: GreekGod installation, AppData, task, firewall rule, or process exists.'
  }
} elseif ($Stage -eq 'Uninstalled') {
  if ($system.installPresent -or $system.taskCount -ne 0 -or $system.firewallRuleCount -ne 0 -or $system.processCount -ne 0) {
    throw 'Uninstalled state failed: installation, task, firewall rule, or process remains.'
  }
  if ($null -eq $marker -or $marker.kitId -ne 'greekgod-final-release-validation') {
    throw 'Uninstalled AppData is not protected by the kit-owned marker.'
  }
} else {
  $allowedMarkers = @('FINAL_FRESH_DISPOSABLE','SANITIZED_REHEARSAL_COPY')
  if ($null -eq $marker -or $allowedMarkers -notcontains [string]$marker.classification -or
      $marker.kitId -ne 'greekgod-final-release-validation') {
    throw 'Disposable validation marker is missing or invalid.'
  }
  if ($Stage -eq 'SeededData') {
    if ($system.installPresent -or $system.taskCount -ne 0 -or $system.firewallRuleCount -ne 0 -or $system.processCount -ne 0) {
      throw 'SeededData must have no installation or system integration.'
    }
    $manifest = Get-Content -LiteralPath (Join-Path $kit 'data\rehearsal-data-manifest.json') -Raw | ConvertFrom-Json
    Assert-FileHash $paths.Database ([string]$manifest.databaseSha256)
    Invoke-ReadOnlyDatabaseCommand (Join-Path $kit 'bin\greekgod-upgrade-rehearsal-verifier.exe') 'audit-seed' $paths.Database @((Join-Path $kit 'data\expectations.json')) 'Seeded data audit'
  } else {
    $expected = if ($Stage -eq 'FreshInstalled' -or $Stage -eq 'FinalInstalled') { '4.0.0' } else { '3.0.3' }
    if (-not $system.installPresent -or $system.productVersion -ne $expected) {
      throw "Expected installed ProductVersion $expected."
    }
    if ($system.taskCount -ne 1 -or -not $system.taskTargetsCurrentService) {
      throw 'Exactly one Sync Service task targeting the current installation is required.'
    }
    if ($system.firewallRuleCount -lt 1 -or -not $system.firewallRulesTargetCurrentService) {
      throw 'GreekGod firewall rules must target the current Sync Service executable.'
    }
    $foreign = @(Get-ProductProcesses | Where-Object {
      $path = [string]$_.ExecutablePath
      $command = [string]$_.CommandLine
      $exe = Join-Path $paths.Install 'greekgod.exe'
      $service = Join-Path $paths.Install 'greekgod-sync-service.exe'
      if (([string]$_.Name).Equals('greekgod.exe',[StringComparison]::OrdinalIgnoreCase)) {
        return -not $path.Equals($exe,[StringComparison]::OrdinalIgnoreCase)
      }
      return -not ($path.Equals($service,[StringComparison]::OrdinalIgnoreCase) -and
        $command.IndexOf($paths.Database,[StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
    if ($foreign.Count -ne 0) { throw 'A GreekGod process does not belong to this disposable validation state.' }
  }
}

Write-Host ("PASS preflight: stage={0}; os={1}; x64=True; freeGB={2:N1}; installToken={3}; appDataToken={4}" -f `
  $Stage,$os.Caption,($drive.FreeSpace/1GB),'%LOCALAPPDATA%\GreekGod','%APPDATA%\com.igorpich.formlog')
