import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createLatestManifest, stageReleaseAssets, validateReleaseAssets } from './release-assets-lib.mjs'
import { cargoPackageVersion, validatePolicyState, validateReleaseOrder, versionFromTag } from './release-lib.mjs'
import policy from './release-policy.json' with { type: 'json' }

const directory = resolve(fileURLToPath(new URL('.', import.meta.url)))
const desktopRoot = resolve(directory, '..', '..')
const repositoryRoot = resolve(desktopRoot, '..', '..')

const validConfig = (version = '4.0.1') => ({
  version,
  identifier: policy.productionIdentifier,
  bundle: { targets: ['nsis'], createUpdaterArtifacts: true },
  plugins: { updater: { pubkey: policy.updaterPublicKey, endpoints: [policy.updaterEndpoint], allowDowngrades: false, windows: { installMode: 'passive' } } },
})

const validState = (overrides = {}) => ({
  tag: 'v4.0.1', rootVersion: '4.0.1', desktopVersion: '4.0.1', cargoVersion: '4.0.1', config: validConfig(), policy, ...overrides,
})

test('Cargo package version parser reads only the package section', () => {
  assert.equal(cargoPackageVersion('[package]\nname = "greekgod"\nversion = "4.0.1"\n\n[dependencies]\nversion = "99.0.0"\n'), '4.0.1')
})

test('stable policy accepts only a matching version above historical 4.0.0', () => {
  assert.equal(validatePolicyState(validState()), '4.0.1')
  for (const tag of ['v4.0.1-rc.1', 'v4.0.1-beta.1', 'v4.0.1-alpha.1', 'v4.0.1-dev', 'v4.0.1-smoke', 'v4.0.1-rehearsal', 'test-v4.0.1']) {
    assert.throws(() => versionFromTag(tag), /stable SemVer|start with v/)
  }
  assert.throws(() => validatePolicyState(validState({ tag: 'v4.0.0', rootVersion: '4.0.0', desktopVersion: '4.0.0', cargoVersion: '4.0.0', config: validConfig('4.0.0') })), /greater than historical/)
})

test('release order must advance beyond the current stable GitHub release', () => {
  assert.deepEqual(validateReleaseOrder('v4.0.2', 'v4.0.1'), { candidate: '4.0.2', current: '4.0.1' })
  assert.throws(() => validateReleaseOrder('v4.0.1', 'v4.0.1'), /must be newer/)
  assert.throws(() => validateReleaseOrder('v4.0.1', 'v4.0.2'), /must be newer/)
  assert.throws(() => validateReleaseOrder('v4.0.2-rc.1', 'v4.0.1'), /stable SemVer/)
})

test('stable policy fails closed on every protected updater setting and version mismatch', () => {
  const mutations = [
    (state) => { state.desktopVersion = '4.0.2' },
    (state) => { state.config.plugins.updater.pubkey = 'changed' },
    (state) => { state.config.plugins.updater.endpoints = ['http://example.invalid/latest.json'] },
    (state) => { state.config.plugins.updater.allowDowngrades = true },
    (state) => { state.config.plugins.updater.windows.installMode = 'quiet' },
    (state) => { state.config.bundle.createUpdaterArtifacts = false },
    (state) => { state.config.bundle.targets = ['msi'] },
  ]
  for (const mutate of mutations) {
    const state = structuredClone(validState())
    mutate(state)
    assert.throws(() => validatePolicyState(state))
  }
})

test('release staging derives the actual signed NSIS filename and emits an exact valid manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'greekgod-release-'))
  const bundle = join(root, 'bundle')
  const output = join(root, 'output')
  mkdirSync(bundle)
  const installer = 'GreekGod_4.0.1_x64-setup.exe'
  const signature = 'R'.repeat(96)
  writeFileSync(join(bundle, installer), 'installer bytes')
  writeFileSync(join(bundle, `${installer}.sig`), `${signature}\n`)
  stageReleaseAssets({ tag: 'v4.0.1', repository: 'IgorPich/DailyTracker', bundleDirectory: bundle, outputDirectory: output, platformKeys: policy.manifestPlatformKeys })
  const result = validateReleaseAssets({ tag: 'v4.0.1', repository: 'IgorPich/DailyTracker', directory: output, platformKeys: policy.manifestPlatformKeys })
  assert.equal(result.installerName, installer)
  const manifest = JSON.parse(readFileSync(join(output, 'latest.json'), 'utf8'))
  assert.equal(manifest.platforms['windows-x86_64-nsis'].signature, signature)
  assert.match(manifest.platforms['windows-x86_64-nsis'].url, /releases\/download\/v4\.0\.1\/GreekGod_4\.0\.1_x64-setup\.exe$/)
})

test('artifact validation rejects malformed, unsigned, mismatched, older and prerelease manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'greekgod-release-negative-'))
  const installer = 'GreekGod_4.0.1_x64-setup.exe'
  const signature = 'S'.repeat(96)
  writeFileSync(join(root, installer), 'installer')
  writeFileSync(join(root, `${installer}.sig`), signature)
  const valid = createLatestManifest({ tag: 'v4.0.1', repository: 'IgorPich/DailyTracker', installerName: installer, signature, platformKeys: policy.manifestPlatformKeys })
  writeFileSync(join(root, 'latest.json'), '{broken')
  assert.throws(() => validateReleaseAssets({ tag: 'v4.0.1', repository: 'IgorPich/DailyTracker', directory: root, platformKeys: policy.manifestPlatformKeys }))
  for (const mutate of [
    (manifest) => { manifest.platforms['windows-x86_64-nsis'].signature = 'invalid' },
    (manifest) => { manifest.version = '4.0.0' },
    (manifest) => { manifest.version = '4.0.2-rc.1' },
  ]) {
    const manifest = structuredClone(valid)
    mutate(manifest)
    writeFileSync(join(root, 'latest.json'), JSON.stringify(manifest))
    assert.throws(() => validateReleaseAssets({ tag: 'v4.0.1', repository: 'IgorPich/DailyTracker', directory: root, platformKeys: policy.manifestPlatformKeys }))
  }
  writeFileSync(join(root, 'latest.json'), JSON.stringify(valid))
  rmSync(join(root, `${installer}.sig`))
  assert.throws(() => validateReleaseAssets({ tag: 'v4.0.1', repository: 'IgorPich/DailyTracker', directory: root, platformKeys: policy.manifestPlatformKeys }), /contract mismatch/)
})

test('release staging rejects unsigned output and an installer built for another version', () => {
  const root = mkdtempSync(join(tmpdir(), 'greekgod-release-selection-'))
  const bundle = join(root, 'bundle')
  mkdirSync(bundle)
  writeFileSync(join(bundle, 'GreekGod_4.0.1_x64-setup.exe'), 'installer')
  assert.throws(() => stageReleaseAssets({ tag: 'v4.0.1', repository: 'IgorPich/DailyTracker', bundleDirectory: bundle, outputDirectory: join(root, 'unsigned'), platformKeys: policy.manifestPlatformKeys }), /exactly one NSIS updater signature/)
  writeFileSync(join(bundle, 'GreekGod_4.0.1_x64-setup.exe.sig'), 'S'.repeat(96))
  assert.throws(() => stageReleaseAssets({ tag: 'v4.0.2', repository: 'IgorPich/DailyTracker', bundleDirectory: bundle, outputDirectory: join(root, 'mismatch'), platformKeys: policy.manifestPlatformKeys }), /does not contain tag version/)
})

test('updater rehearsal is isolated from production storage and Windows lifecycle names', () => {
  const config = JSON.parse(readFileSync(resolve(desktopRoot, 'src-tauri/tauri.updater-rehearsal.conf.json'), 'utf8'))
  assert.equal(config.identifier, 'com.igorpich.formlog.updater-rehearsal')
  assert.equal(config.bundle.windows.nsis.installerHooks, 'windows/updater-rehearsal-hooks.nsh')
  assert.deepEqual(config.plugins.updater.endpoints, ['https://github.com/IgorPich/DailyTracker-updater-rehearsal/releases/latest/download/latest.json'])
  const hooks = readFileSync(resolve(desktopRoot, 'src-tauri/windows/updater-rehearsal-hooks.nsh'), 'utf8')
  assert.match(hooks, /com\.igorpich\.formlog\.updater-rehearsal\\greekgod-v3\.sqlite/)
  assert.match(hooks, /GreekGod Updater Rehearsal Sync Service/)
  assert.doesNotMatch(hooks, /\$APPDATA\\com\.igorpich\.formlog\\greekgod-v3\.sqlite/)
  assert.doesNotMatch(hooks, /\$DESKTOP\\GreekGod\.lnk|\$DESKTOP\\Formlog\.lnk/)
})

test('workflow separates secret-bearing build from token-bearing publish and promotes only after remote validation', () => {
  const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/desktop-stable-release.yml'), 'utf8')
  assert.match(workflow, /tags:\s*\n\s*- 'v\*'/)
  assert.doesNotMatch(workflow, /workflow_dispatch|pull_request/)
  assert.match(workflow, /tauri-apps\/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f/)
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/)
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD \}\}/)
  assert.doesNotMatch(workflow, /secrets\.(?!TAURI_SIGNING_PRIVATE_KEY(?:_PASSWORD)?\b)[A-Z0-9_]+/)
  const buildJob = workflow.split(/^  publish:/m)[0]
  assert.doesNotMatch(buildJob, /GH_TOKEN|GITHUB_TOKEN|github\.token/)
  assert.match(workflow, /release download[\s\S]*validate-release-assets[\s\S]*-Mode Publish/)
  assert.match(workflow, /contents: write/)
  assert.match(workflow, /build-and-validate:[\s\S]*needs: preflight/)
  assert.match(workflow, /group: desktop-stable-release\s/)
  assert.match(workflow, /releases\/latest[\s\S]*validate-release-order[\s\S]*-Mode StageDraft/)
})
