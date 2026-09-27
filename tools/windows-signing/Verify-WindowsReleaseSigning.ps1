[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('DEVELOPMENT','RC','PRIVATE_UNSIGNED','PUBLIC_SIGNED')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$ArtifactRoot,
  [string]$AiPackRoot,
  [string]$UninstallerPath,
  [string]$ExpectedInstallerSha256,
  [string]$ExpectedPublisherSubject,
  [string]$PolicyPath,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($PolicyPath)) { $PolicyPath = Join-Path $PSScriptRoot 'windows-signing-policy.json' }
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$script:errors = New-Object System.Collections.Generic.List[string]
$script:warnings = New-Object System.Collections.Generic.List[string]

function Add-Failure([string]$Code, [string]$Detail) {
  $script:errors.Add("${Code}: ${Detail}")
}

function Add-Warning([string]$Code, [string]$Detail) {
  $script:warnings.Add("${Code}: ${Detail}")
}

function Resolve-RepositoryPath([string]$Value, [string]$RepositoryRoot) {
  if ([IO.Path]::IsPathRooted($Value)) { return [IO.Path]::GetFullPath($Value) }
  return [IO.Path]::GetFullPath((Join-Path $RepositoryRoot $Value))
}

function Invoke-NativeCapture([string]$FileName, [string[]]$Arguments) {
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $FileName
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  # ProcessStartInfo.ArgumentList is unavailable on Windows PowerShell 5.1 / .NET Framework.
  $quoted = foreach ($argument in $Arguments) {
    if ($argument -notmatch '[\s"]') { $argument }
    else { '"' + ($argument -replace '(\\*)"','$1$1\"' -replace '(\\+)$','$1$1') + '"' }
  }
  $start.Arguments = $quoted -join ' '
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  return [pscustomobject]@{ ExitCode=$process.ExitCode; Stdout=[string]$stdout; Stderr=[string]$stderr }
}

function Find-SignTool {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $candidate = Get-ChildItem -LiteralPath $kits -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if ($candidate) { return $candidate.FullName }
  return $null
}

function Test-ArtifactSignature([string]$Path, [string]$SignTool) {
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  $present = $signature.Status -ne [Management.Automation.SignatureStatus]::NotSigned
  $applicationPolicyValid = $false
  $fileDigest = $null
  if ($SignTool) {
    $verify = Invoke-NativeCapture $SignTool @('verify','/pa','/all','/v',$Path)
    $applicationPolicyValid = $verify.ExitCode -eq 0
    $combined = "$($verify.Stdout)`n$($verify.Stderr)"
    if ($combined -match '(?i)Hash of file \((sha256)\)') { $fileDigest = $Matches[1].ToLowerInvariant() }
  }
  $certutil = Invoke-NativeCapture 'certutil.exe' @('-dump',$Path)
  $certificateDump = "$($certutil.Stdout)`n$($certutil.Stderr)"
  $rfc3161 = $certificateDump.Contains('1.3.6.1.4.1.311.3.3.1')
  $timestampDigest = $null
  if ($rfc3161) {
    $index = $certificateDump.IndexOf('1.3.6.1.4.1.311.3.3.1',[StringComparison]::Ordinal)
    $tail = $certificateDump.Substring($index)
    if ($tail -match '(?i)2\.16\.840\.1\.101\.3\.4\.2\.1\s+sha256') { $timestampDigest = 'sha256' }
  }
  return [pscustomobject]@{
    path = [IO.Path]::GetFullPath($Path)
    sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    status = [string]$signature.Status
    signaturePresent = $present
    signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    signerIssuer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Issuer } else { $null }
    signerThumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }
    timestampPresent = $null -ne $signature.TimeStamperCertificate
    timestampSignerSubject = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null }
    applicationPolicyValid = $applicationPolicyValid
    fileDigest = $fileDigest
    timestampProtocol = if ($rfc3161) { 'RFC3161' } else { $null }
    timestampDigest = $timestampDigest
  }
}

function Test-AiPack([string]$Root, [string]$ContractPath, [string]$NativeContractPath) {
  $contract = Get-Content -LiteralPath $ContractPath -Raw | ConvertFrom-Json
  $native = Get-Content -LiteralPath $NativeContractPath -Raw | ConvertFrom-Json
  $manifestPath = Join-Path $Root 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'AI_PACK_MANIFEST_MISSING' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if (($manifest | ConvertTo-Json -Depth 100 -Compress) -ne ($contract | ConvertTo-Json -Depth 100 -Compress)) {
    throw 'AI_PACK_CONTRACT_MISMATCH'
  }
  $files = New-Object System.Collections.Generic.List[object]
  $files.Add([pscustomobject]@{ relativePath=$contract.model.relativePath; bytes=$contract.model.bytes; sha256=$contract.model.sha256 })
  foreach ($file in $contract.runtime.files) {
    $files.Add([pscustomobject]@{ relativePath=("{0}/{1}" -f $contract.runtime.relativePath,$file.relativePath); bytes=$file.bytes; sha256=$file.sha256 })
  }
  foreach ($file in $contract.requiredFiles) {
    $files.Add([pscustomobject]@{ relativePath=$file.relativePath; bytes=$file.bytes; sha256=$file.sha256 })
  }
  if ($contract.windowsNativeRuntimeSet) {
    if ($contract.windowsNativeRuntimeSet -ne $native.contractId) { throw 'AI_PACK_NATIVE_CONTRACT_MISMATCH' }
    foreach ($name in $native.aiPackFiles) {
      $file = $native.files | Where-Object { $_.name -eq $name } | Select-Object -First 1
      if (-not $file) { throw "AI_PACK_NATIVE_FILE_UNDEFINED: $name" }
      $files.Add([pscustomobject]@{ relativePath=("{0}/{1}" -f $contract.runtime.relativePath,$file.name); bytes=$file.bytes; sha256=$file.sha256 })
    }
  }
  $expected = @('manifest.json') + @($files | ForEach-Object { $_.relativePath.Replace('/','\') })
  $actual = @(Get-ChildItem -LiteralPath $Root -Recurse -File | ForEach-Object { $_.FullName.Substring(([IO.Path]::GetFullPath($Root)).Length).TrimStart('\') })
  foreach ($relative in $expected) {
    $path = Join-Path $Root $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "AI_PACK_FILE_MISSING: $relative" }
  }
  foreach ($relative in $actual) {
    if ($expected -notcontains $relative) { throw "AI_PACK_UNEXPECTED_FILE: $relative" }
  }
  foreach ($file in $files) {
    $path = Join-Path $Root $file.relativePath.Replace('/','\')
    $info = Get-Item -LiteralPath $path
    if ($info.Length -ne [long]$file.bytes) { throw "AI_PACK_SIZE_MISMATCH: $($file.relativePath)" }
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne ([string]$file.sha256).ToLowerInvariant()) { throw "AI_PACK_HASH_MISMATCH: $($file.relativePath)" }
  }
  return [pscustomobject]@{ valid=$true; fileCount=$files.Count; packId=$contract.packId; packVersion=$contract.packVersion }
}

$policyFullPath = [IO.Path]::GetFullPath($PolicyPath)
$policy = Get-Content -LiteralPath $policyFullPath -Raw | ConvertFrom-Json
if ($policy.schemaVersion -ne 1) { throw "Unsupported signing policy schema: $($policy.schemaVersion)" }
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$artifactRootFull = [IO.Path]::GetFullPath($ArtifactRoot)
$isPublicSigned = $Mode -eq 'PUBLIC_SIGNED'
$isPrivateUnsigned = $Mode -eq 'PRIVATE_UNSIGNED'
$isRelease = $isPublicSigned -or $isPrivateUnsigned
$signTool = Find-SignTool
if (-not $signTool) { Add-Failure 'SIGNTOOL_MISSING' 'Windows SDK SignTool is required for application-policy verification.' }

$publisher = $ExpectedPublisherSubject
if ([string]::IsNullOrWhiteSpace($publisher)) { $publisher = [string]$policy.expectedPublisherSubject }
if ($isPublicSigned -and [string]::IsNullOrWhiteSpace($publisher)) {
  Add-Failure 'EXPECTED_PUBLISHER_UNRESOLVED' 'Select and configure the production publisher subject before PUBLIC_SIGNED verification.'
}
if ($isRelease) {
  if ($ExpectedInstallerSha256 -notmatch '^[a-fA-F0-9]{64}$') {
    Add-Failure 'INSTALLER_SHA256_REQUIRED' 'PRIVATE_UNSIGNED and PUBLIC_SIGNED require an explicit expected SHA-256 for the exact distributed installer.'
  } else {
    $ExpectedInstallerSha256 = $ExpectedInstallerSha256.ToLowerInvariant()
  }
}

$results = New-Object System.Collections.Generic.List[object]
$expectedPaths = New-Object System.Collections.Generic.List[string]
foreach ($artifact in $policy.requiredArtifacts) {
  $matches = @()
  if ($artifact.relativePath) {
    $candidate = Join-Path $artifactRootFull ([string]$artifact.relativePath).Replace('/','\')
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $matches = @((Get-Item -LiteralPath $candidate)) }
  } else {
    $matches = @(Get-ChildItem -Path (Join-Path $artifactRootFull ([string]$artifact.relativePattern).Replace('/','\')) -File -ErrorAction SilentlyContinue)
  }
  if ($matches.Count -ne 1) {
    Add-Failure 'ARTIFACT_CARDINALITY' "$($artifact.id) expected exactly one file, found $($matches.Count)."
    continue
  }
  $path = $matches[0].FullName
  $expectedPaths.Add([IO.Path]::GetFullPath($path).ToLowerInvariant())
  $inspection = Test-ArtifactSignature $path $signTool
  $results.Add([pscustomobject]@{ id=$artifact.id; kind=$artifact.kind; inspection=$inspection })
  if ($artifact.id -eq 'nsis-installer' -and $isRelease -and $ExpectedInstallerSha256 -match '^[a-f0-9]{64}$' -and $inspection.sha256 -ne $ExpectedInstallerSha256) {
    Add-Failure 'INSTALLER_SHA256_MISMATCH' "Expected $ExpectedInstallerSha256, received $($inspection.sha256)."
  }
  if ($isPublicSigned) {
    if (-not $inspection.signaturePresent) { Add-Failure 'SIGNATURE_REQUIRED' "$($artifact.id) is unsigned."; continue }
    if ($inspection.status -ne 'Valid' -or -not $inspection.applicationPolicyValid) { Add-Failure 'SIGNATURE_INVALID' "$($artifact.id) failed Windows application-policy verification." }
    if ($inspection.fileDigest -ne 'sha256') { Add-Failure 'FILE_DIGEST_POLICY' "$($artifact.id) is not verified as SHA-256 Authenticode." }
    if (-not $inspection.timestampPresent) { Add-Failure 'TIMESTAMP_REQUIRED' "$($artifact.id) has no timestamp." }
    if ($inspection.timestampProtocol -ne 'RFC3161' -or $inspection.timestampDigest -ne 'sha256') { Add-Failure 'TIMESTAMP_POLICY' "$($artifact.id) lacks a verifiable RFC3161/SHA-256 timestamp." }
    if ($publisher -and $inspection.signerSubject -ne $publisher) { Add-Failure 'PUBLISHER_MISMATCH' "$($artifact.id) signer does not exactly match the approved publisher." }
  } elseif (-not $inspection.signaturePresent) {
    if ($isPrivateUnsigned) { Add-Warning 'UNSIGNED_PRIVATE_RELEASE_ALLOWED' "$($artifact.id) is intentionally unsigned under the explicit PRIVATE_UNSIGNED policy." }
    else { Add-Warning 'UNSIGNED_NONFINAL_ALLOWED' "$($artifact.id) is unsigned in explicit $Mode mode." }
  } elseif ($inspection.status -ne 'Valid' -or -not $inspection.applicationPolicyValid) {
    Add-Failure 'PRESENT_SIGNATURE_INVALID' "$($artifact.id) has a signature, but it is invalid."
  }
}

if ($UninstallerPath) {
  if (-not (Test-Path -LiteralPath $UninstallerPath -PathType Leaf)) {
    Add-Failure 'UNINSTALLER_MISSING' $UninstallerPath
  } else {
    $inspection = Test-ArtifactSignature $UninstallerPath $signTool
    $results.Add([pscustomobject]@{ id=$policy.uninstaller.id; kind='GREEKGOD_OWNED_UNINSTALLER'; inspection=$inspection })
    if ($isPublicSigned) {
      if (-not $inspection.signaturePresent) { Add-Failure 'SIGNATURE_REQUIRED' 'NSIS uninstaller is unsigned.' }
      elseif ($inspection.status -ne 'Valid' -or -not $inspection.applicationPolicyValid) { Add-Failure 'SIGNATURE_INVALID' 'NSIS uninstaller failed Windows application-policy verification.' }
      if ($inspection.fileDigest -ne 'sha256') { Add-Failure 'FILE_DIGEST_POLICY' 'NSIS uninstaller is not verified as SHA-256 Authenticode.' }
      if (-not $inspection.timestampPresent -or $inspection.timestampProtocol -ne 'RFC3161' -or $inspection.timestampDigest -ne 'sha256') { Add-Failure 'TIMESTAMP_POLICY' 'NSIS uninstaller lacks a verifiable RFC3161/SHA-256 timestamp.' }
      if ($publisher -and $inspection.signerSubject -ne $publisher) { Add-Failure 'PUBLISHER_MISMATCH' 'NSIS uninstaller signer does not exactly match the approved publisher.' }
    } elseif ($inspection.signaturePresent -and ($inspection.status -ne 'Valid' -or -not $inspection.applicationPolicyValid)) {
      Add-Failure 'PRESENT_SIGNATURE_INVALID' 'NSIS uninstaller has a signature, but it is invalid.'
    }
  }
} elseif ($isPublicSigned) {
  Add-Failure 'UNINSTALLER_EVIDENCE_REQUIRED' 'Install the final NSIS artifact in an isolated target and supply its generated uninstall.exe.'
}

$owned = @(Get-ChildItem -LiteralPath $artifactRootFull -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
  $name = $_.Name
  @($policy.ownedPePatterns | Where-Object { $name -like $_ }).Count -gt 0
})
foreach ($file in $owned) {
  $folded = $file.FullName.ToLowerInvariant()
  if (-not $expectedPaths.Contains($folded)) {
    if ($isRelease) { Add-Failure 'UNEXPECTED_GREEKGOD_PE' $file.FullName }
    else { Add-Warning 'NONFINAL_GREEKGOD_PE_OUTSIDE_SURFACE' $file.FullName }
  }
}

$aiResult = $null
if ($AiPackRoot) {
  try {
    $aiResult = Test-AiPack ([IO.Path]::GetFullPath($AiPackRoot)) (Resolve-RepositoryPath $policy.aiPackContractPath $repositoryRoot) (Resolve-RepositoryPath $policy.nativeRuntimeContractPath $repositoryRoot)
  } catch {
    Add-Failure 'AI_PACK_CONTRACT_FAILED' $_.Exception.Message
  }
} elseif ($isRelease) {
  Add-Failure 'AI_PACK_EVIDENCE_REQUIRED' 'Supply the qualified Offline AI Pack to prove byte identity.'
}

$verdict = 'FAIL'
if ($script:errors.Count -eq 0) { $verdict = 'PASS' }
$publisherReport = $null
if (-not [string]::IsNullOrWhiteSpace($publisher)) { $publisherReport = $publisher }
$report = [ordered]@{
  schemaVersion = 1
  mode = $Mode
  verdict = $verdict
  expectedPublisherSubject = $publisherReport
  signTool = $signTool
  artifacts = $results.ToArray()
  aiPack = $aiResult
  warnings = $script:warnings.ToArray()
  errors = $script:errors.ToArray()
}

if ($Json) { $report | ConvertTo-Json -Depth 12 }
else {
  Write-Output "$($report.verdict) Windows signing verification ($Mode)"
  foreach ($warning in $script:warnings) { Write-Warning $warning }
  foreach ($failure in $script:errors) { Write-Error $failure -ErrorAction Continue }
}
if ($script:errors.Count -gt 0) { exit 1 }
