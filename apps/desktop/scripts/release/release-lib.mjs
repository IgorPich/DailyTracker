import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

export const parseStableVersion = (value, label = 'version') => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
  if (!match) throw new Error(`${label} must be a stable SemVer without prerelease or build metadata: ${value}`)
  return match.slice(1).map(Number)
}

export const compareVersions = (left, right) => {
  const a = parseStableVersion(left)
  const b = parseStableVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

export const versionFromTag = (tag) => {
  if (!/^v/.test(tag)) throw new Error(`Stable release tag must start with v: ${tag}`)
  const version = tag.slice(1)
  parseStableVersion(version, 'release tag')
  return version
}

export const validateReleaseOrder = (candidateTag, currentTag) => {
  const candidate = versionFromTag(candidateTag)
  const current = versionFromTag(currentTag)
  if (compareVersions(candidate, current) <= 0) {
    throw new Error(`Candidate ${candidateTag} must be newer than current stable release ${currentTag}.`)
  }
  return { candidate, current }
}

export const validateGitHubReleaseOrder = ({ candidateTag, latestResponse, releasesResponse, policy }) => {
  if (latestResponse.status === 200) {
    const release = latestResponse.body
    if (!release || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') {
      throw new Error('GitHub latest release response is not a published stable release.')
    }
    return { mode: 'existing-stable', ...validateReleaseOrder(candidateTag, release.tag_name) }
  }

  if (latestResponse.status !== 404) {
    throw new Error(`GitHub latest release request failed with HTTP ${latestResponse.status}.`)
  }
  if (!releasesResponse) {
    throw new Error('GitHub release listing is required after a latest-release 404.')
  }
  if (releasesResponse.status !== 200) {
    throw new Error(`GitHub release listing failed with HTTP ${releasesResponse.status}.`)
  }
  if (!Array.isArray(releasesResponse.body)) {
    throw new Error('GitHub release listing response is malformed.')
  }

  const publishedStable = releasesResponse.body.filter((release) => !release?.draft && !release?.prerelease)
  for (const release of publishedStable) {
    if (typeof release.tag_name !== 'string') throw new Error('A published stable release has no tag.')
    versionFromTag(release.tag_name)
  }
  if (publishedStable.length !== 0) {
    throw new Error('GitHub latest release returned 404 despite published stable releases.')
  }

  const floorTag = `v${policy.historicalVersionFloorExclusive}`
  return { mode: 'first-stable', ...validateReleaseOrder(candidateTag, floorTag) }
}

export const cargoPackageVersion = (contents) => {
  const section = contents.split(/(?=^\[)/m).find((candidate) => /^\[package\]\s*$/m.test(candidate))
  const version = section && /^version\s*=\s*"([^"]+)"\s*$/m.exec(section)?.[1]
  if (!version) throw new Error('Could not read [package].version from Desktop Cargo.toml.')
  return version
}

export const validatePolicyState = ({ tag, rootVersion, desktopVersion, cargoVersion, config, policy }) => {
  const version = versionFromTag(tag)
  if (compareVersions(version, policy.historicalVersionFloorExclusive) <= 0) {
    throw new Error(`Desktop release ${version} must be greater than historical ${policy.historicalVersionFloorExclusive}.`)
  }
  for (const [label, actual] of Object.entries({ rootVersion, desktopVersion, cargoVersion, configVersion: config.version })) {
    if (actual !== version) throw new Error(`${label} ${actual} does not match tag version ${version}.`)
  }
  const updater = config.plugins?.updater
  if (!updater) throw new Error('Tauri updater configuration is missing.')
  if (config.identifier !== policy.productionIdentifier) throw new Error('Production application identifier changed unexpectedly.')
  if (updater.pubkey !== policy.updaterPublicKey) throw new Error('Production updater public key is missing or changed unexpectedly.')
  if (!Array.isArray(updater.endpoints) || updater.endpoints.length !== 1 || updater.endpoints[0] !== policy.updaterEndpoint) {
    throw new Error('Production updater endpoint is missing or changed unexpectedly.')
  }
  if (new URL(updater.endpoints[0]).protocol !== 'https:') throw new Error('Production updater endpoint must use HTTPS.')
  if (updater.allowDowngrades !== false) throw new Error('allowDowngrades must be explicitly false.')
  if (updater.windows?.installMode !== policy.windowsInstallMode) throw new Error('Windows updater installMode must remain passive.')
  if (config.bundle?.createUpdaterArtifacts !== true) throw new Error('Signed updater artifact generation must be enabled.')
  if (JSON.stringify(config.bundle?.targets) !== JSON.stringify([policy.bundleTarget])) throw new Error('Stable Desktop release must build only the NSIS target.')
  return version
}

export const loadProductionPolicyState = (root = repositoryRoot) => {
  const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  return {
    rootVersion: json('package.json').version,
    desktopVersion: json('apps/desktop/package.json').version,
    cargoVersion: cargoPackageVersion(readFileSync(resolve(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8')),
    config: json('apps/desktop/src-tauri/tauri.conf.json'),
    policy: json('apps/desktop/scripts/release/release-policy.json'),
  }
}

export const argumentValue = (name) => {
  const index = process.argv.indexOf(name)
  if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing required argument ${name}.`)
  return process.argv[index + 1]
}
