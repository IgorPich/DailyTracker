import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { auditManualPrivatePolicy } from './verify-manual-private-policy.mjs'

const root = resolve(import.meta.dirname, '../..')

function fixture() {
  const destination = mkdtempSync(join(tmpdir(), 'greekgod-manual-private-'))
  const paths = [
    'package-lock.json',
    'apps/desktop/package.json',
    'apps/desktop/src',
    'apps/desktop/src-tauri/Cargo.toml',
    'apps/desktop/src-tauri/Cargo.lock',
    'apps/desktop/src-tauri/tauri.conf.json',
    'apps/desktop/src-tauri/src',
    'apps/desktop/src-tauri/windows/installer.nsi',
    'apps/sync-service/Cargo.toml',
    'apps/sync-service/Cargo.lock',
    'apps/sync-service/src',
    'crates/greekgod-storage/src/lib.rs',
    'crates/greekgod-sync/src/lib.rs',
    'crates/greekgod-sync-client/src/lib.rs',
    'tools/windows-release/desktop-4.0-release-policy.json',
    'tools/windows-signing/windows-signing-policy.json',
  ]
  for (const relativePath of paths) {
    const target = join(destination, relativePath)
    mkdirSync(resolve(target, '..'), { recursive: true })
    cpSync(join(root, relativePath), target, { recursive: true })
  }
  return destination
}

test('current GreekGod PC 4.0 repository satisfies MANUAL_PRIVATE', () => {
  const report = auditManualPrivatePolicy(root)
  assert.equal(report.verdict, 'PASS', report.failures.join('\n'))
  assert.equal(report.facts.mobilePartOfPc40ReleaseGate, false)
  assert.equal(report.facts.protocolVersion, 1)
  assert.equal(report.facts.schemaVersion, 8)
})

test('guard rejects updater dependencies, endpoints and installer download code', () => {
  const temp = fixture()
  try {
    const packagePath = join(temp, 'apps/desktop/package.json')
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
    packageJson.dependencies['@tauri-apps/plugin-updater'] = '2.0.0'
    writeFileSync(packagePath, JSON.stringify(packageJson))
    const configPath = join(temp, 'apps/desktop/src-tauri/tauri.conf.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.plugins = { updater: { endpoints: ['https://updates.invalid/latest.json'] } }
    writeFileSync(configPath, JSON.stringify(config))
    writeFileSync(join(temp, 'apps/desktop/src/updateClient.ts'), "export const update = () => fetch('https://updates.invalid/GreekGod.exe')\n")
    const report = auditManualPrivatePolicy(temp)
    assert.equal(report.verdict, 'FAIL')
    assert.ok(report.failures.some((failure) => failure.startsWith('UPDATER_DEPENDENCY:')))
    assert.ok(report.failures.some((failure) => failure.startsWith('UPDATER_CONFIG:')))
    assert.ok(report.failures.some((failure) => failure.startsWith('UNEXPECTED_NETWORK_RUNTIME:')))
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('guard rejects release-policy, install-mode and compatibility drift', () => {
  const temp = fixture()
  try {
    const policyPath = join(temp, 'tools/windows-release/desktop-4.0-release-policy.json')
    const policy = JSON.parse(readFileSync(policyPath, 'utf8'))
    policy.updateDistributionPolicy = 'AUTOMATIC'
    policy.mobile.partOfPc40ReleaseGate = true
    writeFileSync(policyPath, JSON.stringify(policy))
    const configPath = join(temp, 'apps/desktop/src-tauri/tauri.conf.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.bundle.windows.nsis.installMode = 'perMachine'
    writeFileSync(configPath, JSON.stringify(config))
    const syncPath = join(temp, 'crates/greekgod-sync/src/lib.rs')
    writeFileSync(syncPath, readFileSync(syncPath, 'utf8').replace('PROTOCOL_VERSION: u32 = 1', 'PROTOCOL_VERSION: u32 = 2'))
    const report = auditManualPrivatePolicy(temp)
    assert.equal(report.verdict, 'FAIL')
    assert.ok(report.failures.some((failure) => failure.startsWith('UPDATE_POLICY:')))
    assert.ok(report.failures.some((failure) => failure.startsWith('MOBILE_BOUNDARY:')))
    assert.ok(report.failures.some((failure) => failure.startsWith('INSTALL_MODE:')))
    assert.ok(report.failures.some((failure) => failure.startsWith('PROTOCOL_VERSION:')))
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
