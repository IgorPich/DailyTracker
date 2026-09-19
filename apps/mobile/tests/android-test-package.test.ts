import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const gradle = await readFile(new URL('../src-tauri/gen/android/app/build.gradle.kts', import.meta.url), 'utf8')
const smokeGradle = await readFile(new URL('../src-tauri/gen/android/app/schema8-smoke.gradle', import.meta.url), 'utf8')
const debugStrings = await readFile(new URL('../src-tauri/gen/android/app/src/debug/res/values/strings.xml', import.meta.url), 'utf8')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const buildScript = await readFile(new URL('../scripts/build-schema8-smoke.mjs', import.meta.url), 'utf8')

test('RC1 Android release metadata is explicit and keeps the production identifier', () => {
  assert.equal(packageJson.version, '4.0.0-rc.1')
  assert.equal(tauriConfig.version, '4.0.0-rc.1')
  assert.equal(tauriConfig.identifier, 'com.igorpich.greekgod.mobile')
  assert.equal(tauriConfig.bundle.android.versionCode, 3000003)
})

test('physical smoke APK cannot replace the stable Android package or look identical', () => {
  assert.match(gradle, /applicationId\s*=\s*"com\.igorpich\.greekgod\.mobile"/)
  assert.match(gradle, /apply\(from\s*=\s*"schema8-smoke\.gradle"\)/)
  assert.match(smokeGradle, /applicationIdSuffix\s+"\.schema8test"/)
  assert.match(gradle, /getByName\("debug"\)[\s\S]*versionNameSuffix\s*=\s*"-schema8-test"/)
  assert.match(debugStrings, /GreekGod Schema 8 TEST/)
  assert.equal(packageJson.scripts['tauri:android:schema8-smoke:build'], 'node scripts/build-schema8-smoke.mjs')
  assert.match(buildScript, /android', 'build', '--debug', '--apk'/)
  assert.match(buildScript, /Creation symbolic link is not allowed for this system/)
})
