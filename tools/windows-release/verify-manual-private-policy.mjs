import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const toolDirectory = dirname(fileURLToPath(import.meta.url))
const defaultRoot = resolve(toolDirectory, '../..')

const read = (root, relativePath) => readFileSync(join(root, relativePath), 'utf8')
const readJson = (root, relativePath) => JSON.parse(read(root, relativePath))

function sourceFiles(root, relativeDirectory, extensions) {
  const directory = join(root, relativeDirectory)
  if (!existsSync(directory)) return []
  const result = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = join(relativeDirectory, entry.name)
    if (entry.isDirectory()) result.push(...sourceFiles(root, relative, extensions))
    else if (extensions.has(extname(entry.name))) result.push(relative)
  }
  return result
}

export function auditManualPrivatePolicy(root = defaultRoot) {
  const failures = []
  const requireCondition = (condition, code, detail) => {
    if (!condition) failures.push(`${code}: ${detail}`)
  }
  const policy = readJson(root, 'tools/windows-release/desktop-4.0-release-policy.json')
  requireCondition(policy.schemaVersion === 1, 'POLICY_SCHEMA', 'Expected policy schema 1.')
  requireCondition(policy.releaseLine === 'GreekGod PC 4.0' && policy.productKind === 'DESKTOP', 'RELEASE_LINE', 'PC 4.0 must be the Desktop release line.')
  requireCondition(policy.updateDistributionPolicy === 'MANUAL_PRIVATE', 'UPDATE_POLICY', 'MANUAL_PRIVATE must be explicitly selected.')
  requireCondition(policy.windowsSigningPolicy === 'PRIVATE_UNSIGNED', 'SIGNING_POLICY', 'MANUAL_PRIVATE PC 4.0 must retain PRIVATE_UNSIGNED.')
  requireCondition(policy.automaticUpdateDiscovery === false && policy.periodicVersionChecks === false, 'AUTOMATIC_CHECKS', 'Automatic discovery and periodic checks must be disabled.')
  requireCondition(Array.isArray(policy.productionUpdateUrls) && policy.productionUpdateUrls.length === 0, 'UPDATE_ENDPOINT', 'No production update URL is allowed.')
  requireCondition(policy.installerDownloads === false && policy.updaterService === false && policy.cloudRequired === false, 'UPDATE_RUNTIME', 'No downloader, updater service, or cloud requirement is allowed.')
  requireCondition(policy.artifactIntegrity === 'FINAL_INSTALLER_SHA256', 'ARTIFACT_INTEGRITY', 'The final installer SHA-256 must identify the distributed artifact.')
  requireCondition(policy.mobile?.releaseLine === 'GreekGod Mobile 2.0' && policy.mobile?.partOfPc40ReleaseGate === false, 'MOBILE_BOUNDARY', 'Mobile 2.0 must remain outside the PC 4.0 gate.')

  const desktopPackage = readJson(root, 'apps/desktop/package.json')
  const dependencies = { ...desktopPackage.dependencies, ...desktopPackage.devDependencies }
  requireCondition(!('@tauri-apps/plugin-updater' in dependencies), 'UPDATER_DEPENDENCY', '@tauri-apps/plugin-updater is forbidden by MANUAL_PRIVATE.')
  const desktopCargo = read(root, 'apps/desktop/src-tauri/Cargo.toml')
  const desktopLock = read(root, 'apps/desktop/src-tauri/Cargo.lock')
  const syncServiceCargo = read(root, 'apps/sync-service/Cargo.toml')
  const syncServiceLock = read(root, 'apps/sync-service/Cargo.lock')
  const npmLock = read(root, 'package-lock.json')
  for (const [name, text] of [['Desktop Cargo.toml', desktopCargo], ['Desktop Cargo.lock', desktopLock], ['Sync Service Cargo.toml', syncServiceCargo], ['Sync Service Cargo.lock', syncServiceLock], ['package-lock.json', npmLock]]) {
    requireCondition(!/tauri[-_]plugin[-_]updater|@tauri-apps\/plugin-updater|\bself[-_]update\b|\bupdate[-_]informer\b/i.test(text), 'UPDATER_DEPENDENCY', `${name} contains an updater dependency.`)
  }

  const tauri = readJson(root, 'apps/desktop/src-tauri/tauri.conf.json')
  requireCondition(!tauri.plugins?.updater, 'UPDATER_CONFIG', 'Tauri updater configuration is forbidden.')
  requireCondition(tauri.build?.devUrl === 'http://localhost:1420', 'DEV_URL', 'The only configured Desktop web URL must remain the loopback development URL.')
  requireCondition(tauri.bundle?.windows?.nsis?.installMode === 'currentUser', 'INSTALL_MODE', 'Expected current-user NSIS installation.')
  requireCondition(tauri.bundle?.windows?.nsis?.template === 'windows/installer.nsi', 'INSTALLER_TEMPLATE', 'Expected the owned, audited NSIS template.')
  const resources = JSON.stringify(tauri.bundle?.resources ?? {})
  requireCondition(!/\.gguf|llama-server|ggml/i.test(resources), 'AI_IN_BASE_INSTALLER', 'The base installer must not bundle Offline AI Pack assets.')

  const updaterPattern = /@tauri-apps\/plugin-updater|tauri[-_]plugin[-_]updater|\bself[-_]update\b|\bupdate[-_]informer\b|checkForUpdates|check_for_updates|releases\/latest|latest\.json|updateEndpoint|update_endpoint|download(?:AndInstall)?Update/i
  const networkPattern = /\bfetch\s*\(|XMLHttpRequest|\bWebSocket\s*\(|\bEventSource\s*\(|reqwest::|ureq::|TcpStream/i
  const runtimeFiles = [
    ...sourceFiles(root, 'apps/desktop/src', new Set(['.ts', '.tsx', '.js', '.jsx'])),
    ...sourceFiles(root, 'apps/desktop/src-tauri/src', new Set(['.rs'])),
  ]
  for (const relativePath of runtimeFiles) {
    const text = read(root, relativePath)
    requireCondition(!updaterPattern.test(text), 'UPDATER_RUNTIME', `${relativePath} contains an automatic-update primitive.`)
    if (!networkPattern.test(text)) continue
    const allowedFileDataRead = relativePath.replaceAll('\\', '/') === 'apps/desktop/src/services/fileService.ts' && /fetch\(dataUrl\)/.test(text)
    const allowedManagedLoopback = relativePath.replaceAll('\\', '/') === 'apps/desktop/src-tauri/src/managed_companion_runtime.rs' &&
      /http:\/\/127\.0\.0\.1:\{port\}/.test(text) && !/https:\/\//.test(text)
    requireCondition(allowedFileDataRead || allowedManagedLoopback, 'UNEXPECTED_NETWORK_RUNTIME', `${relativePath} contains unclassified network-capable runtime code.`)
  }
  const auxiliaryProductionFiles = [
    ...sourceFiles(root, 'apps/sync-service/src', new Set(['.rs'])),
    ...sourceFiles(root, 'apps/desktop/src-tauri/windows', new Set(['.nsi', '.nsh', '.ps1'])),
  ]
  for (const relativePath of auxiliaryProductionFiles) {
    requireCondition(!updaterPattern.test(read(root, relativePath)), 'UPDATER_RUNTIME', `${relativePath} contains an automatic-update primitive.`)
  }

  const installer = read(root, 'apps/desktop/src-tauri/windows/installer.nsi')
  requireCondition(/Var DetectedNsisUpgrade/.test(installer) && /StrCpy \$UpdateMode 1/.test(installer), 'UPGRADE_PATH', 'The audited in-place NSIS UpdateMode path is required.')
  requireCondition(/\$DeleteAppDataCheckboxState = 1[\s\S]*?\$UpdateMode <> 1/.test(installer), 'APPDATA_GUARD', 'Update mode must not delete user AppData.')

  const signingPolicy = readJson(root, 'tools/windows-signing/windows-signing-policy.json')
  requireCondition(signingPolicy.selectedGreekGod40DistributionPolicy === 'PRIVATE_UNSIGNED', 'SIGNING_SELECTION', 'The approved PRIVATE_UNSIGNED policy must remain selected.')
  const sync = read(root, 'crates/greekgod-sync/src/lib.rs')
  const syncClient = read(root, 'crates/greekgod-sync-client/src/lib.rs')
  const storage = read(root, 'crates/greekgod-storage/src/lib.rs')
  requireCondition(/PROTOCOL_VERSION:\s*u32\s*=\s*1\s*;/.test(sync), 'PROTOCOL_VERSION', 'Sync protocol must remain 1.')
  requireCondition(/SUPPORTED_SCHEMA_VERSION:\s*i64\s*=\s*8\s*;/.test(syncClient), 'CLIENT_SCHEMA', 'Existing mobile sync client must remain on schema 8.')
  requireCondition(/PRAGMA user_version = 8;/.test(storage), 'STORAGE_SCHEMA', 'Authority storage must retain schema 8.')

  return {
    schemaVersion: 1,
    policyId: policy.policyId,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
    facts: {
      releaseLine: policy.releaseLine,
      updateDistributionPolicy: policy.updateDistributionPolicy,
      windowsSigningPolicy: policy.windowsSigningPolicy,
      installMode: tauri.bundle.windows.nsis.installMode,
      protocolVersion: policy.compatibility.protocolVersion,
      schemaVersion: policy.compatibility.schemaVersion,
      mobilePartOfPc40ReleaseGate: policy.mobile.partOfPc40ReleaseGate,
    },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootArgument = process.argv.indexOf('--root')
  const root = rootArgument >= 0 ? resolve(process.argv[rootArgument + 1]) : defaultRoot
  const report = auditManualPrivatePolicy(root)
  console.log(JSON.stringify(report, null, 2))
  if (report.verdict !== 'PASS') process.exitCode = 1
}
