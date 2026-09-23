import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contractPath = join(desktop, 'src-tauri', 'windows-native-runtime', 'greekgod-windows-native-runtime.json')
export const contract = JSON.parse(await readFile(contractPath, 'utf8'))

const sha256 = async (path) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function verifyRuntimeDirectory(root, names = contract.aiPackFiles) {
  const files = new Map(contract.files.map((file) => [file.name.toLowerCase(), file]))
  for (const name of names) {
    const expected = files.get(name.toLowerCase())
    if (!expected || expected.architecture !== 'x64') throw new Error(`NATIVE_RUNTIME_CONTRACT_INVALID: ${name}`)
    const path = join(root, expected.name)
    const info = await stat(path).catch(() => null)
    if (!info?.isFile() || info.size !== expected.bytes) throw new Error(`NATIVE_PREREQUISITE_MISSING_OR_INVALID: ${name}`)
    if (await sha256(path) !== expected.sha256) throw new Error(`NATIVE_PREREQUISITE_HASH_MISMATCH: ${name}`)
  }
  return true
}

function candidates() {
  if (process.env.GREEKGOD_VC_REDIST_ROOT) return [resolve(process.env.GREEKGOD_VC_REDIST_ROOT)]
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  const result = spawnSync(vswhere, ['-all', '-products', '*', '-find', 'VC\\Redist\\MSVC\\**\\x64\\Microsoft.VC143.CRT'], { encoding: 'utf8' })
  if (result.status !== 0) return []
  return result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
}

export async function findVerifiedSource() {
  for (const candidate of candidates()) {
    try { await verifyRuntimeDirectory(candidate); return candidate } catch { /* exact contract required */ }
  }
  throw new Error('VERIFIED_VC_REDIST_SOURCE_NOT_FOUND: set GREEKGOD_VC_REDIST_ROOT to the exact approved Microsoft.VC143.CRT x64 directory')
}

export async function prepareBaseRuntime(source) {
  source ??= await findVerifiedSource()
  await verifyRuntimeDirectory(source)
  const destination = join(desktop, 'src-tauri', 'binaries', 'windows-native-runtime')
  await mkdir(destination, { recursive: true })
  for (const name of contract.baseFiles) {
    const temporary = join(destination, `${name}.tmp`)
    await rm(temporary, { force: true })
    await copyFile(join(source, name), temporary)
    await rm(join(destination, name), { force: true })
    await rename(temporary, join(destination, name))
  }
  await verifyRuntimeDirectory(destination, contract.baseFiles)
  return { source, destination }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareBaseRuntime()
    console.log(`Prepared pinned app-local VC runtime: ${result.destination}`)
  } catch (error) {
    console.error(`FAIL ${error.message}`)
    process.exitCode = 1
  }
}
