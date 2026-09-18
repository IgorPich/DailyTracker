function ConvertTo-SmokeNodeArgument {
  param([AllowEmptyString()][string]$Value)

  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }

  $quoted = '"'
  $backslashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') {
      $backslashes += 1
      continue
    }
    if ($character -eq '"') {
      $quoted += ('\' * (($backslashes * 2) + 1)) + '"'
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) {
      $quoted += '\' * $backslashes
      $backslashes = 0
    }
    $quoted += $character
  }
  if ($backslashes -gt 0) { $quoted += '\' * ($backslashes * 2) }
  return $quoted + '"'
}

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
  # START*.cmd intentionally uses Windows PowerShell 5.1, whose .NET Framework
  # ProcessStartInfo has no ArgumentList collection. Build its command line with
  # the standard Windows quoting rules instead.
  $startInfo.Arguments = (($Arguments | ForEach-Object {
    ConvertTo-SmokeNodeArgument -Value $_
  }) -join ' ')

  $process = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $process) { throw "$Label failed to start Node." }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdoutResult = $stdoutTask.GetAwaiter().GetResult()
  $stderrResult = $stderrTask.GetAwaiter().GetResult()
  $stdout = if ($null -eq $stdoutResult) { '' } else { ([string]$stdoutResult).Trim() }
  $stderr = if ($null -eq $stderrResult) { '' } else { ([string]$stderrResult).Trim() }

  if ($process.ExitCode -ne 0 -or -not [string]::IsNullOrWhiteSpace($stderr)) {
    $stdoutDisplay = if ([string]::IsNullOrWhiteSpace($stdout)) { '<empty>' } else { $stdout }
    $stderrDisplay = if ([string]::IsNullOrWhiteSpace($stderr)) { '<empty>' } else { $stderr }
    throw "$Label failed (exit code $($process.ExitCode)).`nSTDOUT:`n$stdoutDisplay`nSTDERR:`n$stderrDisplay"
  }
  if (-not [string]::IsNullOrEmpty($stdout)) { return $stdout }
}
