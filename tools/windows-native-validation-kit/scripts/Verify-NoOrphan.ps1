[CmdletBinding()]
param()

. (Join-Path $PSScriptRoot 'NativeValidation.Common.ps1')
$managedRoots = @(Get-ManagedRoots)
$orphans = @(Get-CimInstance Win32_Process -Filter "Name = 'llama-server.exe'" -ErrorAction SilentlyContinue | Where-Object {
  $path = $_.ExecutablePath
  if ([string]::IsNullOrWhiteSpace($path)) { return $false }
  foreach ($root in $managedRoots) {
    $prefix = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
    if ([IO.Path]::GetFullPath($path).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
})
$result = [ordered]@{ result=$(if($orphans.Count -eq 0){'PASS'}else{'FAIL'}); managedLlamaProcessCount=$orphans.Count }
Write-SafeJson 'no-orphan.json' $result | Out-Null
$result | ConvertTo-Json
if ($orphans.Count -ne 0) { exit 1 }
