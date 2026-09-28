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
const currentInstaller = join(currentArtifacts, 'bundle/nsis/GreekGod_4.0.0_x64-setup.exe')
const powershell = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
const run = (args) => spawnSync(powershell, ['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',verifier,...args], { encoding: 'utf8' })
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const rc = run(['-Mode','RC','-ArtifactRoot',currentArtifacts,'-Json'])
assert.equal(rc.status, 0, rc.stdout + rc.stderr)
assert.match(rc.stdout, /UNSIGNED_NONFINAL_ALLOWED/)

const noPolicy = run(['-ArtifactRoot',currentArtifacts,'-Json'])
assert.notEqual(noPolicy.status, 0, 'release policy selection must be explicit')

const aiContract = JSON.parse(readFileSync(join(root, 'apps/desktop/src-tauri/ai-pack/greekgod-ai-pack-4.0.json'), 'utf8'))
const nativeContract = JSON.parse(readFileSync(join(root, 'apps/desktop/src-tauri/windows-native-runtime/greekgod-windows-native-runtime.json'), 'utf8'))
assert.equal(1 + aiContract.runtime.files.length + aiContract.requiredFiles.length + nativeContract.aiPackFiles.length, 33)

const temp = mkdtempSync(join(tmpdir(), 'greekgod-signing-'))
try {
  mkdirSync(join(temp, 'artifacts/bundle/nsis'), { recursive: true })
  mkdirSync(join(temp, 'unsigned/bundle/nsis'), { recursive: true })
  mkdirSync(join(temp, 'pack'), { recursive: true })
  for (const path of ['artifacts/greekgod.exe','artifacts/greekgod-sync-service.exe','artifacts/bundle/nsis/GreekGod_4.0.0_x64-setup.exe','uninstall.exe']) {
    copyFileSync(signedFixture, join(temp, path))
  }
  const model = Buffer.from('qualified-test-model')
  const digest = sha256(model)
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
  const signedInstallerHash = sha256(readFileSync(join(temp,'artifacts/bundle/nsis/GreekGod_4.0.0_x64-setup.exe')))
  const valid = run(['-Mode','PUBLIC_SIGNED','-ArtifactRoot',join(temp,'artifacts'),'-AiPackRoot',join(temp,'pack'),'-UninstallerPath',join(temp,'uninstall.exe'),'-ExpectedInstallerSha256',signedInstallerHash,'-ExpectedPublisherSubject',subject,'-PolicyPath',join(temp,'policy.json'),'-Json'])
  assert.equal(valid.status, 0, valid.stdout + valid.stderr)

  copyFileSync(join(currentArtifacts, 'greekgod.exe'), join(temp, 'unsigned/greekgod.exe'))
  copyFileSync(join(currentArtifacts, 'greekgod-sync-service.exe'), join(temp, 'unsigned/greekgod-sync-service.exe'))
  copyFileSync(currentInstaller, join(temp, 'unsigned/bundle/nsis/GreekGod_4.0.0_x64-setup.exe'))
  const unsignedInstallerHash = sha256(readFileSync(currentInstaller))
  const privateUnsigned = run(['-Mode','PRIVATE_UNSIGNED','-ArtifactRoot',join(temp,'unsigned'),'-AiPackRoot',join(temp,'pack'),'-ExpectedInstallerSha256',unsignedInstallerHash,'-PolicyPath',join(temp,'policy.json'),'-Json'])
  assert.equal(privateUnsigned.status, 0, privateUnsigned.stdout + privateUnsigned.stderr)
  assert.match(privateUnsigned.stdout, /UNSIGNED_PRIVATE_RELEASE_ALLOWED/)

  const publicUnsigned = run(['-Mode','PUBLIC_SIGNED','-ArtifactRoot',join(temp,'unsigned'),'-AiPackRoot',join(temp,'pack'),'-UninstallerPath',join(temp,'unsigned/greekgod.exe'),'-ExpectedInstallerSha256',unsignedInstallerHash,'-ExpectedPublisherSubject',subject,'-PolicyPath',join(temp,'policy.json'),'-Json'])
  assert.equal(publicUnsigned.status, 1)
  assert.match(publicUnsigned.stdout, /SIGNATURE_REQUIRED/)

  const wrongHash = run(['-Mode','PRIVATE_UNSIGNED','-ArtifactRoot',join(temp,'unsigned'),'-AiPackRoot',join(temp,'pack'),'-ExpectedInstallerSha256','0'.repeat(64),'-PolicyPath',join(temp,'policy.json'),'-Json'])
  assert.equal(wrongHash.status, 1)
  assert.match(wrongHash.stdout, /INSTALLER_SHA256_MISMATCH/)

  writeFileSync(join(temp, 'pack/model.bin'), Buffer.from('tampered-test-model'))
  const badPack = run(['-Mode','PRIVATE_UNSIGNED','-ArtifactRoot',join(temp,'unsigned'),'-AiPackRoot',join(temp,'pack'),'-ExpectedInstallerSha256',unsignedInstallerHash,'-PolicyPath',join(temp,'policy.json'),'-Json'])
  assert.equal(badPack.status, 1)
  assert.match(badPack.stdout, /AI_PACK_CONTRACT_FAILED/)
  writeFileSync(join(temp, 'pack/model.bin'), model)

  const tamperedPath = join(temp, 'artifacts/greekgod.exe')
  const tampered = readFileSync(tamperedPath)
  tampered[1024] ^= 0xff
  writeFileSync(tamperedPath, tampered)
  const invalid = run(['-Mode','PRIVATE_UNSIGNED','-ArtifactRoot',join(temp,'artifacts'),'-AiPackRoot',join(temp,'pack'),'-ExpectedInstallerSha256',signedInstallerHash,'-PolicyPath',join(temp,'policy.json'),'-Json'])
  assert.equal(invalid.status, 1)
  assert.match(invalid.stdout, /PRESENT_SIGNATURE_INVALID/)
} finally {
  rmSync(temp, { recursive: true, force: true })
}

console.log('PASS explicit DEVELOPMENT/RC/PRIVATE_UNSIGNED/PUBLIC_SIGNED Windows release policy guard')
