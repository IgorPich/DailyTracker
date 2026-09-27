import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '../..')
const verifier = join(root, 'tools/windows-signing/Verify-WindowsReleaseSigning.ps1')
const currentArtifacts = join(root, 'apps/desktop/src-tauri/target/release')
const signedFixture = join(root, 'apps/desktop/src-tauri/binaries/windows-native-runtime/vcruntime140.dll')
const powershell = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
const run = (args) => spawnSync(powershell, ['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',verifier,...args], { encoding: 'utf8' })

const rc = run(['-Mode','RC','-ArtifactRoot',currentArtifacts,'-Json'])
assert.equal(rc.status, 0, rc.stdout + rc.stderr)
assert.match(rc.stdout, /UNSIGNED_NONFINAL_ALLOWED/)

const finalUnsigned = run(['-Mode','Final','-ArtifactRoot',currentArtifacts,'-ExpectedPublisherSubject','CN=UNRESOLVED','-Json'])
assert.equal(finalUnsigned.status, 1)
assert.match(finalUnsigned.stdout, /SIGNATURE_REQUIRED/)
assert.match(finalUnsigned.stdout, /AI_PACK_EVIDENCE_REQUIRED/)

const temp = mkdtempSync(join(tmpdir(), 'greekgod-signing-'))
try {
  mkdirSync(join(temp, 'artifacts/bundle/nsis'), { recursive: true })
  mkdirSync(join(temp, 'pack'), { recursive: true })
  for (const path of ['artifacts/greekgod.exe','artifacts/greekgod-sync-service.exe','artifacts/bundle/nsis/GreekGod_4.0.0-rc.1_x64-setup.exe','uninstall.exe']) {
    copyFileSync(signedFixture, join(temp, path))
  }
  const model = Buffer.from('qualified-test-model')
  const digest = createHash('sha256').update(model).digest('hex')
  writeFileSync(join(temp, 'pack/model.bin'), model)
  const contract = {
    manifestFormatVersion: 1,
    packId: 'signing-verifier-fixture',
    packVersion: '1',
    model: { relativePath: 'model.bin', bytes: model.length, sha256: digest },
    runtime: { relativePath: 'runtime', files: [] },
    requiredFiles: [],
  }
  writeFileSync(join(temp, 'pack/manifest.json'), `${JSON.stringify(contract, null, 2)}\n`)
  writeFileSync(join(temp, 'ai-contract.json'), `${JSON.stringify(contract, null, 2)}\n`)
  writeFileSync(join(temp, 'native-contract.json'), '{"contractId":"none","aiPackFiles":[],"files":[]}\n')
  const policy = JSON.parse(readFileSync(join(root, 'tools/windows-signing/windows-signing-policy.json'), 'utf8'))
  policy.aiPackContractPath = join(temp, 'ai-contract.json')
  policy.nativeRuntimeContractPath = join(temp, 'native-contract.json')
  writeFileSync(join(temp, 'policy.json'), `${JSON.stringify(policy, null, 2)}\n`)
  const subject = 'CN=Microsoft Windows Software Compatibility Publisher, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'
  const valid = run(['-Mode','Final','-ArtifactRoot',join(temp,'artifacts'),'-AiPackRoot',join(temp,'pack'),'-UninstallerPath',join(temp,'uninstall.exe'),'-ExpectedPublisherSubject',subject,'-PolicyPath',join(temp,'policy.json'),'-Json'])
  assert.equal(valid.status, 0, valid.stdout + valid.stderr)
  const tamperedPath = join(temp, 'artifacts/greekgod.exe')
  const tampered = readFileSync(tamperedPath)
  tampered[1024] ^= 0xff
  writeFileSync(tamperedPath, tampered)
  const invalid = run(['-Mode','Final','-ArtifactRoot',join(temp,'artifacts'),'-AiPackRoot',join(temp,'pack'),'-UninstallerPath',join(temp,'uninstall.exe'),'-ExpectedPublisherSubject',subject,'-PolicyPath',join(temp,'policy.json'),'-Json'])
  assert.equal(invalid.status, 1)
  assert.match(invalid.stdout, /SIGNATURE_INVALID/)
} finally {
  rmSync(temp, { recursive: true, force: true })
}

console.log('PASS Windows signing verifier and unsigned-FINAL guard')
