[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Install', 'PrepareUpdate', 'Uninstall', 'InstallTask', 'UninstallTask', 'InstallFirewall', 'RemoveFirewall')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$ServiceExecutable,

  [Parameter(Mandatory = $true)]
  [string]$DatabasePath,

  [string]$TaskName = 'GreekGod Sync Service',
  [string]$FirewallRulePrefix = 'GreekGod Sync Service',
  [int]$Port = 39173
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3

function Assert-SafeConfiguration {
  if (-not [IO.Path]::IsPathRooted($ServiceExecutable)) {
    throw 'Sync Service executable path must be absolute.'
  }
  if ([IO.Path]::GetFileName($ServiceExecutable) -ne 'greekgod-sync-service.exe') {
    throw 'Unexpected Sync Service executable filename.'
  }
  if (-not [IO.Path]::IsPathRooted($DatabasePath) -or
      [IO.Path]::GetFileName($DatabasePath) -ne 'greekgod-v3.sqlite') {
    throw 'Sync Service database path must be absolute and end in greekgod-v3.sqlite.'
  }
  if ($Port -ne 39173) {
    throw 'GreekGod v3 installer permits only the fixed sync port 39173.'
  }
  if ($TaskName -notmatch '^[A-Za-z0-9 ._()-]{1,80}$' -or
      $FirewallRulePrefix -notmatch '^[A-Za-z0-9 ._()-]{1,80}$') {
    throw 'Task or firewall rule name contains unsupported characters.'
  }
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Stop-GreekGodSyncTask {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($null -ne $task -and $task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $TaskName
    for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
      Start-Sleep -Milliseconds 100
      $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      if ($null -eq $task -or $task.State -ne 'Running') { break }
    }
  }

  Get-CimInstance Win32_Process -Filter "Name = 'greekgod-sync-service.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq $ServiceExecutable } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

function Get-SyncServiceVersionContract {
  $standardOutputPath = [IO.Path]::GetTempFileName()
  $standardErrorPath = [IO.Path]::GetTempFileName()
  try {
    $process = Start-Process `
      -FilePath $ServiceExecutable `
      -ArgumentList '--version-json' `
      -WindowStyle Hidden `
      -RedirectStandardOutput $standardOutputPath `
      -RedirectStandardError $standardErrorPath `
      -Wait `
      -PassThru
    if ($process.ExitCode -ne 0) {
      throw 'Sync Service version handshake command failed.'
    }
    $versionJson = Get-Content -LiteralPath $standardOutputPath -Raw
    if ([string]::IsNullOrWhiteSpace($versionJson)) {
      throw 'Sync Service version handshake returned no output.'
    }
    return $versionJson | ConvertFrom-Json
  }
  finally {
    Remove-Item -LiteralPath $standardOutputPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $standardErrorPath -Force -ErrorAction SilentlyContinue
  }
}

function Install-GreekGodSyncTask {
  if (-not (Test-Path -LiteralPath $ServiceExecutable -PathType Leaf)) {
    throw "Sync Service executable does not exist: $ServiceExecutable"
  }
  $versionContract = Get-SyncServiceVersionContract
  if ([string]::IsNullOrWhiteSpace($versionContract.serviceVersion) -or
      $versionContract.protocolVersion -ne 1) {
    throw 'Sync Service binary has an incompatible version contract.'
  }
  Stop-GreekGodSyncTask

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $arguments = "--database `"$DatabasePath`" --bind-private-lan"
  $taskAction = New-ScheduledTaskAction `
    -Execute $ServiceExecutable `
    -Argument $arguments `
    -WorkingDirectory ([IO.Path]::GetDirectoryName($ServiceExecutable))
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal = New-ScheduledTaskPrincipal `
    -UserId $identity `
    -LogonType Interactive `
    -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
  $definition = New-ScheduledTask `
    -Action $taskAction `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'GreekGod local-only HTTPS sync for the current Windows user.'
  Register-ScheduledTask -TaskName $TaskName -InputObject $definition -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName

  for ($attempt = 0; $attempt -lt 100; $attempt += 1) {
    Start-Sleep -Milliseconds 100
    $process = Get-CimInstance Win32_Process -Filter "Name = 'greekgod-sync-service.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -eq $ServiceExecutable -and $_.CommandLine.Contains($DatabasePath) } |
      Select-Object -First 1
    if ($null -ne $process) { return }
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if ($task.State -eq 'Disabled') {
      throw 'Sync Service scheduled task became disabled during startup.'
    }
  }
  throw 'Sync Service scheduled task did not start its process in time.'
}

function Uninstall-GreekGodSyncTask {
  Stop-GreekGodSyncTask
  if ($null -ne (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
}

function Get-FirewallRuleNames {
  return @(
    "$FirewallRulePrefix HTTPS Private",
    "$FirewallRulePrefix mDNS Private"
  )
}

function Remove-GreekGodFirewallRules {
  if (-not (Test-IsAdministrator)) {
    throw 'Administrator elevation is required to remove GreekGod firewall rules.'
  }
  foreach ($name in Get-FirewallRuleNames) {
    Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  }
}

function Install-GreekGodFirewallRules {
  if (-not (Test-IsAdministrator)) {
    throw 'Administrator elevation is required to install GreekGod firewall rules.'
  }
  if (-not (Test-Path -LiteralPath $ServiceExecutable -PathType Leaf)) {
    throw "Sync Service executable does not exist: $ServiceExecutable"
  }
  Remove-GreekGodFirewallRules
  $names = Get-FirewallRuleNames
  New-NetFirewallRule `
    -Name $names[0] `
    -DisplayName $names[0] `
    -Description 'GreekGod authenticated HTTPS sync on private local networks only.' `
    -Direction Inbound `
    -Action Allow `
    -Enabled True `
    -Profile Private `
    -Program $ServiceExecutable `
    -Protocol TCP `
    -LocalPort $Port `
    -RemoteAddress LocalSubnet `
    -EdgeTraversalPolicy Block | Out-Null
  New-NetFirewallRule `
    -Name $names[1] `
    -DisplayName $names[1] `
    -Description 'GreekGod DNS-SD discovery on private local networks only.' `
    -Direction Inbound `
    -Action Allow `
    -Enabled True `
    -Profile Private `
    -Program $ServiceExecutable `
    -Protocol UDP `
    -LocalPort 5353 `
    -RemoteAddress LocalSubnet `
    -EdgeTraversalPolicy Block | Out-Null
}

function Invoke-ElevatedFirewallAction([string]$FirewallAction) {
  $quotedScript = '"' + $PSCommandPath + '"'
  $quotedExecutable = '"' + $ServiceExecutable + '"'
  $quotedDatabase = '"' + $DatabasePath + '"'
  $quotedTask = '"' + $TaskName + '"'
  $quotedPrefix = '"' + $FirewallRulePrefix + '"'
  $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File $quotedScript -Action $FirewallAction -ServiceExecutable $quotedExecutable -DatabasePath $quotedDatabase -TaskName $quotedTask -FirewallRulePrefix $quotedPrefix -Port $Port"
  $process = Start-Process `
    -FilePath 'powershell.exe' `
    -Verb RunAs `
    -ArgumentList $arguments `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Elevated firewall action failed with exit code $($process.ExitCode)."
  }
}

Assert-SafeConfiguration

switch ($Action) {
  'Install' {
    Install-GreekGodSyncTask
    Invoke-ElevatedFirewallAction 'InstallFirewall'
  }
  'PrepareUpdate' {
    Stop-GreekGodSyncTask
  }
  'Uninstall' {
    Uninstall-GreekGodSyncTask
    Invoke-ElevatedFirewallAction 'RemoveFirewall'
  }
  'InstallTask' { Install-GreekGodSyncTask }
  'UninstallTask' { Uninstall-GreekGodSyncTask }
  'InstallFirewall' { Install-GreekGodFirewallRules }
  'RemoveFirewall' { Remove-GreekGodFirewallRules }
}
