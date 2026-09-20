import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const kit = resolve(import.meta.dirname, '../../../tools/upgrade-rehearsal-kit')
const scripts = readdirSync(kit).filter((name) => name.endsWith('.ps1'))

test('all rehearsal scripts parse in Windows PowerShell 5.1', { skip: process.platform !== 'win32' }, () => {
  for (const name of scripts) {
    const path = join(kit, name)
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '$errors=$null; [void][Management.Automation.Language.Parser]::ParseFile($env:GREEKGOD_PS_TEST_FILE,[ref]$null,[ref]$errors); if($errors.Count){$errors|ForEach-Object{[Console]::Error.WriteLine($_)};exit 1}',
    ], { stdio: 'pipe', env: { ...process.env, GREEKGOD_PS_TEST_FILE: path } })
  }
})

test('scripts avoid known PowerShell Core-only APIs and unsafe automatic installer execution', () => {
  for (const name of scripts) {
    const text = readFileSync(join(kit, name), 'utf8')
    assert.doesNotMatch(text, /\.Contains\s*\([^\r\n]*StringComparison/i, name)
    assert.doesNotMatch(text, /\.ArgumentList\b/i, name)
    assert.doesNotMatch(text, /ConvertFrom-Json\s+[^\r\n]*-AsHashtable/i, name)
    assert.doesNotMatch(text, /ForEach-Object\s+[^\r\n]*-Parallel/i, name)
    assert.doesNotMatch(text, /Start-Process[^\r\n]*(?:3\.0\.3|4\.0\.0-rc\.1).*setup/i, name)
  }
})

test('kit enforces immutable artifact hashes, isolation marker, and read-only staged verification', () => {
  const common = readFileSync(join(kit, 'Common.ps1'), 'utf8')
  assert.match(common, /F040143048C67B558AB126D4403DACFE2A3873F9860FF38558FB024D254FBEC9/)
  assert.match(common, /934725CFFAF670FA5A78A725AE6AB9467880B1708CAB4688ABD3AE282D52DBF8/)
  assert.match(readFileSync(join(kit, 'Test-Preflight.ps1'), 'utf8'), /AcknowledgeDisposableEnvironment/)
  assert.match(readFileSync(join(kit, 'Install-RehearsalData.ps1'), 'utf8'), /SANITIZED_REHEARSAL_COPY/)
  assert.match(readFileSync(join(kit, 'Collect-Evidence.ps1'), 'utf8'), /restart-3-comparison\.json/)
})
