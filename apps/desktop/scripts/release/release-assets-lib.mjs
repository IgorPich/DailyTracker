import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseStableVersion, versionFromTag } from './release-lib.mjs'

const json = (path) => JSON.parse(readFileSync(path, 'utf8'))

export const discoverSignedNsisArtifact = (bundleDirectory) => {
  const files = readdirSync(bundleDirectory, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)
  const signatures = files.filter((name) => name.endsWith('-setup.exe.sig'))
  if (signatures.length !== 1) throw new Error(`Expected exactly one NSIS updater signature, found ${signatures.length}.`)
  const signatureName = signatures[0]
  const installerName = signatureName.slice(0, -4)
  if (!files.includes(installerName)) throw new Error(`Signed NSIS installer is missing: ${installerName}`)
  const signature = readFileSync(join(bundleDirectory, signatureName), 'utf8').trim()
  if (signature.length < 64) throw new Error('Updater signature is empty or malformed.')
  return { installerName, signatureName, signature }
}

export const createLatestManifest = ({ tag, repository, installerName, signature, platformKeys }) => {
  const version = versionFromTag(tag)
  const encodedName = encodeURIComponent(installerName)
  const url = `https://github.com/${repository}/releases/download/${tag}/${encodedName}`
  return {
    version,
    platforms: Object.fromEntries(platformKeys.map((key) => [key, { signature, url }])),
  }
}

export const stageReleaseAssets = ({ tag, repository, bundleDirectory, outputDirectory, platformKeys }) => {
  const artifact = discoverSignedNsisArtifact(bundleDirectory)
  const version = versionFromTag(tag)
  if (!artifact.installerName.includes(`_${version}_`)) {
    throw new Error(`Signed installer filename ${artifact.installerName} does not contain tag version ${version}.`)
  }
  mkdirSync(outputDirectory, { recursive: true })
  copyFileSync(join(bundleDirectory, artifact.installerName), join(outputDirectory, artifact.installerName))
  copyFileSync(join(bundleDirectory, artifact.signatureName), join(outputDirectory, artifact.signatureName))
  const manifest = createLatestManifest({ tag, repository, installerName: artifact.installerName, signature: artifact.signature, platformKeys })
  writeFileSync(join(outputDirectory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { ...artifact, manifest }
}

export const validateReleaseAssets = ({ tag, repository, directory, platformKeys }) => {
  const expectedVersion = versionFromTag(tag)
  parseStableVersion(expectedVersion)
  const manifest = json(join(directory, 'latest.json'))
  if (manifest.version !== expectedVersion) throw new Error(`Manifest version ${manifest.version} does not match ${expectedVersion}.`)
  const entries = platformKeys.map((key) => {
    const entry = manifest.platforms?.[key]
    if (!entry) throw new Error(`Manifest platform ${key} is missing.`)
    return entry
  })
  const canonical = JSON.stringify(entries[0])
  if (entries.some((entry) => JSON.stringify(entry) !== canonical)) throw new Error('Windows NSIS manifest aliases do not select the same signed artifact.')
  const entry = entries[0]
  const url = new URL(entry.url)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') throw new Error('Updater artifact URL must use GitHub HTTPS.')
  const expectedPrefix = `/${repository}/releases/download/${tag}/`
  if (!url.pathname.startsWith(expectedPrefix)) throw new Error('Updater artifact URL does not target the exact repository and tag.')
  const installerName = decodeURIComponent(basename(url.pathname))
  if (!installerName.endsWith('-setup.exe')) throw new Error('Manifest does not select an NSIS installer.')
  if (!installerName.includes(`_${expectedVersion}_`)) throw new Error('Manifest installer filename does not match the tag version.')
  const signatureName = `${installerName}.sig`
  const files = readdirSync(directory, { withFileTypes: true }).filter((item) => item.isFile()).map((item) => item.name).sort()
  const expectedFiles = ['latest.json', installerName, signatureName].sort()
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) throw new Error(`Release asset contract mismatch: ${JSON.stringify(files)}`)
  const signature = readFileSync(resolve(directory, signatureName), 'utf8').trim()
  if (!signature || signature !== entry.signature) throw new Error('Manifest signature does not exactly match the updater signature asset.')
  return { version: expectedVersion, installerName, signatureName, manifestName: 'latest.json' }
}
