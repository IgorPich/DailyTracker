[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('TrackerLaunch','CompanionInference')][string]$Kind,
  [Parameter(Mandatory=$true)][ValidateSet('PASS','FAIL')][string]$Result,
  [ValidatePattern('^[A-Za-z0-9_.:-]{0,120}$')][string]$FailureCode = ''
)

. (Join-Path $PSScriptRoot 'NativeValidation.Common.ps1')
if ($Kind -eq 'TrackerLaunch' -and $Result -eq 'PASS' -and $null -eq (Get-Process -Name 'greekgod' -ErrorAction SilentlyContinue)) {
  throw 'TRACKER_PROCESS_NOT_RUNNING'
}
$name = if ($Kind -eq 'TrackerLaunch') { 'tracker-launch.json' } else { 'companion-inference.json' }
$value = [ordered]@{ result=$Result; failureCode=$(if($FailureCode){$FailureCode}else{$null}) }
Write-SafeJson $name $value | Out-Null
$value | ConvertTo-Json
