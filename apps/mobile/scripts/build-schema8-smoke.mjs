import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: mobileRoot,
  encoding: 'utf8',
  stdio: 'inherit',
  ...options,
})

const apk = resolve(mobileRoot, 'src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk')
const rustLibrary = resolve(mobileRoot, 'src-tauri/target/aarch64-linux-android/debug/libgreekgod_mobile_lib.so')
rmSync(apk, { force: true })
rmSync(rustLibrary, { force: true })
const tauriCli = resolve(mobileRoot, '../../node_modules/@tauri-apps/cli/tauri.js')
const startedAt = Date.now()
const tauri = run(process.execPath, [tauriCli, 'android', 'build', '--debug', '--apk'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
process.stdout.write(tauri.stdout ?? '')
process.stderr.write(tauri.stderr ?? '')
if (tauri.status === 0) process.exit(0)

// Tauri uses a symlink for the Rust library. Windows without Developer Mode can
// safely finish the identical Gradle build with a normal file copy instead.
const jniLibrary = resolve(mobileRoot, 'src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libgreekgod_mobile_lib.so')
const tauriOutput = `${tauri.stdout ?? ''}\n${tauri.stderr ?? ''}`
const knownSymlinkFailure = tauriOutput.includes('Creation symbolic link is not allowed for this system')
const freshRustLibrary = existsSync(rustLibrary) && statSync(rustLibrary).mtimeMs >= startedAt
if (process.platform !== 'win32' || !knownSymlinkFailure || !freshRustLibrary) process.exit(tauri.status ?? 1)
mkdirSync(dirname(jniLibrary), { recursive: true })
copyFileSync(rustLibrary, jniLibrary)
const gradle = run(process.env.ComSpec ?? 'cmd.exe', [
  '/d', '/s', '/c', 'gradlew.bat', ':app:assembleArm64Debug', '-x', ':app:rustBuildArm64Debug',
], {
  cwd: resolve(mobileRoot, 'src-tauri/gen/android'),
})
process.exit(gradle.status ?? 1)
