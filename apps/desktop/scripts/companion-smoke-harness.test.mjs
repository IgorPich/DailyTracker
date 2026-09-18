import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const start = readFileSync(new URL('./start-companion-product-ux-smoke.ps1', import.meta.url), 'utf8')
const audit = readFileSync(new URL('./audit-companion-product-ux-smoke.mjs', import.meta.url), 'utf8')
const seed = readFileSync(new URL('./seed-companion-product-ux-smoke.mjs', import.meta.url), 'utf8')
const invoke = readFileSync(new URL('./invoke-smoke-node.ps1', import.meta.url), 'utf8')
const readiness = readFileSync(new URL('./wait-companion-product-ux-bootstrap.mjs', import.meta.url), 'utf8')
const recorder = readFileSync(new URL('./record-companion-product-ux-smoke-state.ps1', import.meta.url), 'utf8')
const processFilterScripts = [
  'record-companion-product-ux-smoke-state.ps1',
  'set-companion-product-ux-smoke-model.ps1',
  'start-companion-product-ux-smoke.ps1',
  'stop-companion-product-ux-smoke.ps1',
].map(name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))

test('fresh Companion UX smoke always archives isolated state and restores the baseline seed', () => {
  assert.match(audit, /expectedPrescription = '3 × 5–7'/)
  assert.match(seed, /prescription: '3 × 5–7'/)
  const archive = start.indexOf('Move-Item -LiteralPath $existingRoot')
  const reseed = start.indexOf("'seed-companion-product-ux-smoke.mjs'")
  const launch = start.indexOf("Start-Process -FilePath 'npm.cmd'")
  assert.ok(archive >= 0 && reseed > archive && launch > reseed)
  assert.match(start, /if \(Test-Path -LiteralPath \$smokeRoot\)/)
  assert.doesNotMatch(start, /if \(-not \(Test-Path -LiteralPath \$smokeRoot\)\)[\s\S]{0,200}seed-companion-product-ux-smoke/)
  assert.match(start, /syntheticOnly -ne \$true/)
})

test('bootstrap readiness is bounded and precedes the strict state audit', () => {
  const barrier = start.indexOf("'wait-companion-product-ux-bootstrap.mjs'")
  const stateAudit = start.indexOf("'audit-companion-product-ux-smoke.mjs'")
  assert.ok(barrier >= 0 && stateAudit > barrier)
  assert.match(readiness, /timeoutMs > 0 && timeoutMs <= 60_000/)
  assert.match(readiness, /bootstrap_state/)
  assert.match(readiness, /bootstrap state is/)
  assert.match(readiness, /Timed out waiting for isolated SQLite bootstrap/)
})

test('Node wrapper captures both streams and keeps exit and stderr failures fatal', () => {
  assert.match(invoke, /RedirectStandardOutput = \$true/)
  assert.match(invoke, /RedirectStandardError = \$true/)
  assert.match(invoke, /\$process\.ExitCode -ne 0 -or -not \[string\]::IsNullOrWhiteSpace\(\$stderr\)/)
  assert.match(invoke, /failed \(exit code \$\(\$process\.ExitCode\)\)/)
  assert.match(invoke, /STDOUT:/)
  assert.match(invoke, /STDERR:/)
  assert.doesNotMatch(invoke, /\.ArgumentList\.Add/)
  assert.match(invoke, /\$startInfo\.Arguments/)
  assert.match(invoke, /\$null -eq \$stdoutResult/)
  assert.match(invoke, /\$null -eq \$stderrResult/)
  assert.doesNotMatch(start, /2>&1/)
})

test('Node wrapper handles empty streams and failures in the Windows PowerShell launcher host', () => {
  const script = new URL('./invoke-smoke-node.test.ps1', import.meta.url)
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    decodeURIComponent(script.pathname).replace(/^\/(.:)/, '$1'),
  ], { encoding: 'utf8' })

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /stream and exit handling: PASS/)
})

test('managed sidecar filters use a case-insensitive Windows PowerShell 5.1-compatible API', () => {
  for (const source of processFilterScripts) {
    assert.doesNotMatch(source, /\.Contains\([^\r\n]*\[StringComparison\]::/)
    assert.match(source, /\.IndexOf\([^\r\n]*\[StringComparison\]::OrdinalIgnoreCase\) -ge 0/)
  }

  const script = new URL('./companion-smoke-process-filter.test.ps1', import.meta.url)
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    decodeURIComponent(script.pathname).replace(/^\/(.:)/, '$1'),
  ], { encoding: 'utf8' })

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /process filter compatibility: PASS/)
  assert.match(recorder, /if \(\$decoded -is \[Array\]\) \{ \$existing = @\(/)
  assert.match(recorder, /ConvertTo-Json -InputObject @\(\$existing \+ \[pscustomobject\]\$record\)/)
})
