param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$AssetsDirectory,
    [Parameter(Mandatory = $true)][ValidateSet('StageDraft', 'Publish')][string]$Mode
)

$ErrorActionPreference = 'Stop'
if ($Tag -notmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
    throw "Refusing non-stable release tag: $Tag"
}
if ([string]::IsNullOrWhiteSpace($env:GH_TOKEN)) { throw 'GH_TOKEN is required.' }

if ($Mode -eq 'StageDraft') {
    $existing = & gh release view $Tag --json isDraft 2>$null
    if ($LASTEXITCODE -eq 0) {
        if (-not (($existing | ConvertFrom-Json).isDraft)) { throw "Release $Tag is already published; refusing to replace it." }
    } else {
        & gh release create $Tag --verify-tag --draft --title "GreekGod $($Tag.Substring(1))" --generate-notes
        if ($LASTEXITCODE -ne 0) { throw "Could not create draft release $Tag." }
    }
    $assets = @(Get-ChildItem -LiteralPath $AssetsDirectory -File | ForEach-Object FullName)
    if ($assets.Count -ne 3) { throw "Expected exactly three validated release assets, found $($assets.Count)." }
    & gh release upload $Tag @assets --clobber
    if ($LASTEXITCODE -ne 0) { throw "Could not upload release assets for $Tag." }
    return
}

$release = & gh release view $Tag --json isDraft,isPrerelease
if ($LASTEXITCODE -ne 0) { throw "Draft release $Tag does not exist." }
$state = $release | ConvertFrom-Json
if (-not $state.isDraft -or $state.isPrerelease) { throw "Release $Tag is not an eligible stable draft." }
& gh release edit $Tag --draft=false --prerelease=false --latest
if ($LASTEXITCODE -ne 0) { throw "Could not publish stable release $Tag." }
