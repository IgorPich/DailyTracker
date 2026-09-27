import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

const kit = resolve(import.meta.dirname, '../../../tools/upgrade-rehearsal-kit')
const scripts = readdirSync(kit).filter((name) => name.endsWith('.ps1'))
const read = (name) => readFileSync(join(kit, name), 'utf8')

test('all Phase 6B scripts parse in Windows PowerShell 5.1', { skip: process.platform !== 'win32' }, () => {
  for (const name of scripts) {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '$errors=$null; [void][Management.Automation.Language.Parser]::ParseFile($env:GREEKGOD_PS_TEST_FILE,[ref]$null,[ref]$errors); if($errors.Count){$errors|ForEach-Object{[Console]::Error.WriteLine($_)};exit 1}',
    ], { stdio: 'pipe', env: { ...process.env, GREEKGOD_PS_TEST_FILE: join(kit, name) } })
  }
})

test('scripts stay PS5.1-compatible and never automate an installer UI', () => {
  for (const name of scripts) {
    const text = read(name)
    assert.doesNotMatch(text, /\.Contains\s*\([^\r\n]*StringComparison/i, name)
    assert.doesNotMatch(text, /\.ArgumentList\b/i, name)
    assert.doesNotMatch(text, /ConvertFrom-Json\s+[^\r\n]*-AsHashtable/i, name)
    assert.doesNotMatch(text, /ForEach-Object\s+[^\r\n]*-Parallel/i, name)
    assert.doesNotMatch(text, /Start-Process[^\r\n]*(?:3\.0\.3|Phase6|4\.0\.0).*setup/i, name)
  }
})

test('builder pins exact artifacts, copies exactly three seed files, and records no builder identity', () => {
  const common = read('Common.ps1')
  const builder = read('New-RehearsalKit.ps1')
  assert.match(common, /F040143048C67B558AB126D4403DACFE2A3873F9860FF38558FB024D254FBEC9/)
  assert.match(common, /6E2FD4129A4672A5414C2920F4D795410FA1C0E8BBB7D2B5EE5D995F40236CFB/)
  assert.match(common, /Phase6Bytes = 6698493/)
  assert.match(builder, /foreach \(\$source in @\(\$database, \$dataManifest, \$expectations\)\)/)
  assert.doesNotMatch(builder, /sourceMachine|sourceUser|COMPUTERNAME|USERNAME/)
  assert.doesNotMatch(read('Collect-Evidence.ps1'), /machine\s*=|user\s*=|COMPUTERNAME|USERNAME/i)
})

test('SQLite verification uses disposable copies and cannot add sidecars to packaged data', () => {
  const common = read('Common.ps1')
  assert.match(common, /function Invoke-ReadOnlyDatabaseCommand/)
  assert.match(common, /greekgod-db-audit-/)
  assert.match(common, /Copy-Item -LiteralPath \$Database -Destination \$copy/)
  assert.match(common, /Remove-Item -LiteralPath \$resolved -Recurse -Force/)
  for (const name of ['New-RehearsalKit.ps1', 'Test-KitIntegrity.ps1', 'Test-Preflight.ps1', 'Capture-Baseline.ps1', 'Capture-PostUpgrade.ps1']) {
    assert.match(read(name), /Invoke-ReadOnlyDatabaseCommand/, name)
  }
})

test('README fixes the exact manual order and UX remains human-attested', () => {
  const readme = read('README.md')
  const ordered = [
    'Scenario 1 — fresh Phase 6 installation',
    'Mark-FreshTestData.ps1',
    'Remove-KitOwnedAppData.ps1',
    'Scenario 2 — stable upgrade with controlled cancellation',
    'Capture-Baseline.ps1',
    'Capture-Cancellation.ps1',
    'Scenario 3 — completed stable upgrade',
    'Capture-PostUpgrade.ps1 -LaunchNumber First',
    'Collect-Evidence.ps1',
  ]
  let cursor = -1
  for (const token of ordered) {
    const next = readme.indexOf(token)
    assert.ok(next > cursor, `README token is missing or out of order: ${token}`)
    cursor = next
  }
  const checklist = JSON.parse(read('ux-checklist.json'))
  assert.equal(checklist.items.length, 9)
  assert.ok(checklist.items.every((item) => item.status === 'PENDING' && item.evidence === ''))
})

test('evidence collector validator accepts complete synthetic fixtures under PowerShell 5.1', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'greekgod-phase6-evidence-test-'))
  try {
    const systemFiles = ['fresh-install-system.json','fresh-uninstalled-system.json','cancelled-system.json','phase6-system.json']
    for (const name of systemFiles) writeFileSync(join(root, name), '{"formatVersion":1}\n')
    const captures = {
      'baseline.json': { schemaVersion: 7, protocolVersion: 1 },
      'cancelled-upgrade.json': { schemaVersion: 7, protocolVersion: 1 },
      'post-upgrade.json': { schemaVersion: 8, protocolVersion: 1 },
      'restart-2.json': { schemaVersion: 8, protocolVersion: 1 },
      'restart-3.json': { schemaVersion: 8, protocolVersion: 1 },
    }
    for (const [name, value] of Object.entries(captures)) writeFileSync(join(root, name), `${JSON.stringify(value)}\n`)
    for (const name of ['cancellation-comparison.json','upgrade-comparison.json','restart-2-comparison.json','restart-3-comparison.json']) {
      writeFileSync(join(root, name), '{"formatVersion":1,"verdict":"PASS"}\n')
    }
    const template = JSON.parse(read('ux-checklist.json'))
    template.items = template.items.map((item) => ({ ...item, status: 'PASS', evidence: 'synthetic fixture' }))
    const checklist = join(root, 'ux-checklist.json')
    writeFileSync(checklist, `${JSON.stringify(template)}\n`)
    execFileSync('powershell.exe', [
      '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(kit,'Test-EvidenceSet.ps1'),
      '-EvidenceRoot',root,'-UxChecklistPath',checklist,
    ], { stdio: 'pipe' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
