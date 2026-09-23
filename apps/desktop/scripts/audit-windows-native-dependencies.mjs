import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repository = resolve(desktop, '..', '..')
const packContract = JSON.parse(await readFile(join(desktop, 'src-tauri', 'ai-pack', 'greekgod-ai-pack-4.0.json'), 'utf8'))

const sha256 = async (path) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function findDumpbin() {
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  const result = execFileSync(vswhere, ['-latest', '-products', '*', '-find', 'VC\\Tools\\MSVC\\**\\bin\\Hostx64\\x64\\dumpbin.exe'], { encoding: 'utf8' })
  const path = result.split(/\r?\n/).map((item) => item.trim()).find(Boolean)
  if (!path) throw new Error('Authoritative Visual Studio dumpbin.exe was not found')
  return path
}

function classify(name, bundled) {
  const lower = name.toLowerCase()
  if (bundled.has(lower)) return 'BUNDLED_APPLICATION_RUNTIME'
  if (lower.startsWith('api-ms-win-crt-') || lower === 'ucrtbase.dll') return 'WINDOWS_UCRT_API_SET'
  if (/^(msvcp|vcruntime|concrt)140(?:_[12])?\.dll$/.test(lower)) return 'MICROSOFT_VISUAL_CPP_RUNTIME'
  if (lower === 'vulkan-1.dll') return 'GPU_DRIVER_PROVIDED'
  return 'WINDOWS_10_11_SYSTEM_COMPONENT'
}

export async function audit({ runtime, output }) {
  if (!runtime || !output) throw new Error('Usage: --runtime <approved b10760 runtime directory> --output <inventory.json>')
  const dumpbin = findDumpbin()
  const binaries = [
    { component: 'DESKTOP', path: join(desktop, 'src-tauri', 'target', 'release', 'greekgod.exe') },
    { component: 'SYNC_SERVICE', path: join(desktop, 'src-tauri', 'binaries', 'greekgod-sync-service-x86_64-pc-windows-msvc.exe') },
  ]
  for (const expected of packContract.runtime.files) {
    const path = join(resolve(runtime), expected.relativePath)
    const info = await stat(path)
    if (info.size !== expected.bytes || await sha256(path) !== expected.sha256) throw new Error(`Approved runtime mismatch: ${expected.relativePath}`)
    if (/\.(?:exe|dll)$/i.test(expected.relativePath)) binaries.push({ component: 'LLAMA_CPP_B10760', path })
  }
  const bundled = new Set(binaries.filter((item) => item.component === 'LLAMA_CPP_B10760').map((item) => basename(item.path).toLowerCase()))
  const files = []
  for (const binary of binaries) {
    const headers = execFileSync(dumpbin, ['/NOLOGO', '/HEADERS', binary.path], { encoding: 'utf8' })
    if (!/machine \(x64\)/i.test(headers)) throw new Error(`Non-x64 production PE: ${basename(binary.path)}`)
    const dependencies = execFileSync(dumpbin, ['/NOLOGO', '/DEPENDENTS', binary.path], { encoding: 'utf8' })
    const imports = [...dependencies.matchAll(/^    ([A-Za-z0-9_.-]+\.dll)$/gmi)]
      .map((match) => match[1].toLowerCase()).sort()
      .filter((name, index, all) => index === 0 || name !== all[index - 1])
      .map((name) => ({ name, classification: classify(name, bundled) }))
    const info = await stat(binary.path)
    files.push({ name: basename(binary.path), component: binary.component, architecture: 'x64', bytes: info.size, sha256: await sha256(binary.path), imports })
  }
  const inventory = {
    schemaVersion: 1,
    scope: 'GreekGod 4.0 production Desktop, Sync Service, and approved llama.cpp b10760 PE files',
    llamaCpp: { build: packContract.runtime.build, commit: packContract.runtime.commit, trustedRuntimeFiles: packContract.runtime.files.length },
    omitted: [{ name: 'llama-quantize.exe', reason: 'Not present in or distributed by the authoritative 24-file runtime contract' }],
    peFileCount: files.length,
    files,
  }
  await writeFile(resolve(repository, output), `${JSON.stringify(inventory, null, 2)}\n`)
  return inventory
}

function args(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 2) result[values[index].replace(/^--/, '')] = values[index + 1]
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await audit(args(process.argv.slice(2)))
    console.log(`PASS audited ${result.peFileCount} exact x64 production PE files`)
  } catch (error) {
    console.error(`FAIL ${error.message}`)
    process.exitCode = 1
  }
}
