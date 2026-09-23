[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'NativeValidation.Common.ps1')

$manifest = Get-KitManifest
$installer = Join-Path (Get-KitRoot) ('installer\' + $manifest.installer.fileName)
$inputValid = $true
$inputFailure = $null
try {
  $file = Get-Item -LiteralPath $installer
  if ($file.Length -ne $manifest.installer.bytes -or (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.installer.sha256) {
    throw 'INSTALLER_HASH_MISMATCH'
  }
  & (Join-Path $PSScriptRoot 'Test-AiPack.ps1') | Out-Null
} catch {
  $inputValid = $false
  $inputFailure = $_.Exception.Message
}

$os = Get-CimInstance Win32_OperatingSystem
$systemDrive = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
$kitDriveName = [IO.Path]::GetPathRoot((Get-KitRoot)).TrimEnd('\')
$kitDrive = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $kitDriveName + "'")
$processExists = $null -ne (Get-Process -Name 'greekgod' -ErrorAction SilentlyContinue)
$syncProcessExists = $null -ne (Get-Process -Name 'greekgod-sync-service' -ErrorAction SilentlyContinue)
$taskExists = $null -ne (Get-ScheduledTask -TaskName 'GreekGod Sync Service' -ErrorAction SilentlyContinue)
$firewallExists = $false
if ($null -ne (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue)) {
  $firewallExists = $null -ne (Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'GreekGod Sync Service*' } | Select-Object -First 1)
}
$roamingDataExists = Test-Path -LiteralPath (Join-Path $env:APPDATA 'com.igorpich.formlog')
$localDataExists = Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'com.igorpich.formlog')
$installFileExists = @(
  (Join-Path $env:LOCALAPPDATA 'GreekGod\greekgod.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\GreekGod\greekgod.exe'),
  (Join-Path $env:USERPROFILE 'Desktop\GreekGod.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\GreekGod.lnk')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$installFileExists = $null -ne $installFileExists
$uninstallEntries = @()
foreach ($view in @('Registry64','Registry32')) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::$view)
  $key = $base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
  if ($null -ne $key) {
    foreach ($name in $key.GetSubKeyNames()) {
      $item = $key.OpenSubKey($name)
      $displayName = [string]$item.GetValue('DisplayName')
      if ($displayName -match 'Microsoft Visual C\+\+.*Redistributable') {
        $uninstallEntries += [ordered]@{ name=$displayName; version=[string]$item.GetValue('DisplayVersion'); registryView=$view }
      }
      $item.Dispose()
    }
    $key.Dispose()
  }
  $base.Dispose()
}
$greekGodInstalled = $false
$userUninstall = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
if ($null -ne $userUninstall) {
  foreach ($name in $userUninstall.GetSubKeyNames()) {
    $item = $userUninstall.OpenSubKey($name)
    if ([string]$item.GetValue('DisplayName') -eq 'GreekGod') { $greekGodInstalled = $true }
    $item.Dispose()
  }
  $userUninstall.Dispose()
}
$runtimeFiles = @()
foreach ($location in @([Environment]::SystemDirectory, (Join-Path $env:SystemRoot 'SysWOW64'))) {
  $label = if ($location.EndsWith('SysWOW64', [StringComparison]::OrdinalIgnoreCase)) { 'SYSWOW64' } else { 'SYSTEM32' }
  foreach ($name in @('msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll')) {
    $path = Join-Path $location $name
    $runtimeFiles += [ordered]@{ location=$label; name=$name; exists=(Test-Path -LiteralPath $path -PathType Leaf); version=$(if(Test-Path -LiteralPath $path -PathType Leaf){(Get-Item -LiteralPath $path).VersionInfo.FileVersion}else{$null}) }
  }
}
$webView = @()
foreach ($view in @('Registry64','Registry32')) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::$view)
  $clients = $base.OpenSubKey('SOFTWARE\Microsoft\EdgeUpdate\Clients')
  if ($null -ne $clients) {
    foreach ($name in $clients.GetSubKeyNames()) {
      $item = $clients.OpenSubKey($name)
      if ([string]$item.GetValue('name') -match 'WebView2') { $webView += [ordered]@{ version=[string]$item.GetValue('pv'); registryView=$view } }
      $item.Dispose()
    }
    $clients.Dispose()
  }
  $base.Dispose()
}

$minimumFree = 8GB
$classification = 'CLEAN_ENOUGH'
$reasons = New-Object System.Collections.Generic.List[string]
if (-not $inputValid -or -not [Environment]::Is64BitOperatingSystem -or [Environment]::OSVersion.Version.Major -lt 10 -or $systemDrive.FreeSpace -lt $minimumFree) {
  $classification = 'UNSUITABLE'
  if (-not $inputValid) { $reasons.Add($inputFailure) }
  if (-not [Environment]::Is64BitOperatingSystem) { $reasons.Add('OS_NOT_X64') }
  if ([Environment]::OSVersion.Version.Major -lt 10) { $reasons.Add('WINDOWS_VERSION_UNSUPPORTED') }
  if ($systemDrive.FreeSpace -lt $minimumFree) { $reasons.Add('INSUFFICIENT_SYSTEM_DRIVE_SPACE') }
} elseif ($greekGodInstalled -or $installFileExists -or $processExists -or $syncProcessExists -or $taskExists -or $firewallExists -or $roamingDataExists -or $localDataExists) {
  $classification = 'CONTAMINATED_FOR_STRICT_TEST'
  $reasons.Add('EXISTING_GREEKGOD_STATE')
}

$result = [ordered]@{
  formatVersion=1
  os=[ordered]@{ caption=$os.Caption; version=$os.Version; buildNumber=$os.BuildNumber; architecture=$os.OSArchitecture }
  architecture=$(if([Environment]::Is64BitOperatingSystem){'x64'}else{'not-x64'})
  classification=$classification
  reasons=@($reasons)
  kitInputsValid=$inputValid
  systemDriveFreeBytes=[uint64]$systemDrive.FreeSpace
  kitDriveFreeBytes=[uint64]$kitDrive.FreeSpace
  existingGreekGod=[ordered]@{ installed=$greekGodInstalled; installFileOrShortcut=$installFileExists; desktopProcess=$processExists; syncProcess=$syncProcessExists; roamingAppData=$roamingDataExists; localAppData=$localDataExists; scheduledTask=$taskExists; firewallRule=$firewallExists }
  installedVcRedistributables=$uninstallEntries
  systemVcRuntimeFiles=$runtimeFiles
  webView2=$webView
  note='Installed VC redistributables do not change classification; actual app-local module origins decide PASS.'
}
Write-SafeJson 'preflight.json' $result | Out-Null
$result | ConvertTo-Json -Depth 12
if ($classification -ne 'CLEAN_ENOUGH') { exit 2 }
