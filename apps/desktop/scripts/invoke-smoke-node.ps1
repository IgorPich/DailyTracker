function Invoke-SmokeNode {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $node = (Get-Command node -ErrorAction Stop).Source
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $node
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($argument in $Arguments) { $null = $startInfo.ArgumentList.Add($argument) }

  $process = [Diagnostics.Process]::Start($startInfo)
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
  $stderr = $stderrTask.GetAwaiter().GetResult().Trim()

  if ($process.ExitCode -ne 0 -or -not [string]::IsNullOrWhiteSpace($stderr)) {
    $stdoutDisplay = if ([string]::IsNullOrWhiteSpace($stdout)) { '<empty>' } else { $stdout }
    $stderrDisplay = if ([string]::IsNullOrWhiteSpace($stderr)) { '<empty>' } else { $stderr }
    throw "$Label failed (exit code $($process.ExitCode)).`nSTDOUT:`n$stdoutDisplay`nSTDERR:`n$stderrDisplay"
  }
  return $stdout
}
