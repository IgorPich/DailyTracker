import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = resolve(scriptDir, '../../../..')
export const contractPath = join(repositoryRoot, 'apps/desktop/src-tauri/ai-pack/greekgod-ai-pack-4.0.json')
export const expectedContract = JSON.parse(await readFile(contractPath, 'utf8'))

const safeRelative = (value) => typeof value === 'string' && value.length > 0 && !isAbsolute(value)
  && !value.includes('\\') && !value.includes(':') && value.split('/').every((part) => part && part !== '.' && part !== '..')
const runtimePath = (contract, file) => `${contract.runtime.relativePath}/${file.relativePath}`

export function contractFiles(contract = expectedContract) {
  const files = [
    { path: contract.model.relativePath, bytes: contract.model.bytes, sha256: contract.model.sha256, kind: 'MODEL' },
    ...contract.runtime.files.map((file) => ({ path: runtimePath(contract, file), bytes: file.bytes, sha256: file.sha256, kind: 'RUNTIME' })),
    ...contract.requiredFiles.map((file) => ({ path: file.relativePath, bytes: file.bytes, sha256: file.sha256, kind: file.kind })),
  ]
  const seen = new Set()
  for (const file of files) {
    if (!safeRelative(file.path)) throw new Error(`UNSAFE_PATH: ${file.path}`)
    const folded = file.path.toLocaleLowerCase('en-US')
    if (seen.has(folded)) throw new Error(`DUPLICATE_PATH: ${file.path}`)
    seen.add(folded)
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`INVALID_FILE_CONTRACT: ${file.path}`)
  }
  return files
}

export function validateContract(contract, expected = expectedContract) {
  if (contract?.manifestFormatVersion !== 1) throw new Error('UNSUPPORTED_MANIFEST_VERSION')
  contractFiles(contract)
  if (!isDeepStrictEqual(contract, expected)) throw new Error('PACK_CONTRACT_MISMATCH')
  return contract
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function listFiles(root, current = root, result = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name)
    const stat = await lstat(absolute)
    if (stat.isSymbolicLink()) throw new Error(`UNSAFE_REPARSE_POINT: ${relative(root, absolute)}`)
    if (entry.isDirectory()) await listFiles(root, absolute, result)
    else if (entry.isFile()) result.push(relative(root, absolute).split(sep).join('/'))
    else throw new Error(`UNSUPPORTED_FILE_OBJECT: ${relative(root, absolute)}`)
  }
  return result
}

export async function verifyPack(root, expected = expectedContract) {
  const absoluteRoot = resolve(root)
  const rootStat = await lstat(absoluteRoot).catch(() => null)
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error('PACK_MISSING_OR_UNSAFE')
  const manifestBytes = await readFile(join(absoluteRoot, 'manifest.json'))
  if (manifestBytes.length > 1024 * 1024) throw new Error('MANIFEST_INVALID')
  let manifest
  try { manifest = JSON.parse(manifestBytes) } catch (error) { throw new Error(`MANIFEST_INVALID: ${error.message}`) }
  validateContract(manifest, expected)
  const expectedFiles = contractFiles(expected)
  const allowed = new Map(expectedFiles.map((file) => [file.path.toLocaleLowerCase('en-US'), file.path]))
  const actual = await listFiles(absoluteRoot)
  const seen = new Set()
  for (const path of actual) {
    const folded = path.toLocaleLowerCase('en-US')
    if (seen.has(folded)) throw new Error(`DUPLICATE_PATH: ${path}`)
    seen.add(folded)
    if (path !== 'manifest.json' && !allowed.has(folded)) throw new Error(`UNEXPECTED_FILE: ${path}`)
  }
  const inventory = []
  for (const file of expectedFiles) {
    if (!actual.includes(file.path)) throw new Error(`${file.kind}_MISSING: ${file.path}`)
    const absolute = join(absoluteRoot, ...file.path.split('/'))
    const stat = await lstat(absolute)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes) throw new Error(`${file.kind}_INVALID_SIZE: ${file.path}`)
    const digest = await sha256(absolute)
    if (digest !== file.sha256) throw new Error(`${file.kind}_INVALID_HASH: ${file.path}`)
    inventory.push({ relativePath: file.path, bytes: stat.size, sha256: digest })
  }
  return { manifestFormatVersion: manifest.manifestFormatVersion, packId: manifest.packId, packVersion: manifest.packVersion, files: inventory }
}

const legalSources = new Map([
  ['legal/LICENSE-Microsoft-Phi-3.5', 'legal/companion-model/LICENSE-Microsoft-Phi-3.5'],
  ['legal/NOTICE-Microsoft-Phi-3.5.md', 'legal/companion-model/NOTICE-Microsoft-Phi-3.5.md'],
  ['legal/LICENSE-llama.cpp', 'legal/companion-model/LICENSE-llama.cpp'],
  ['provenance/phi-3.5-provenance.json', 'legal/companion-model/provenance.json'],
])

async function verifiedCopy(source, destination, expected) {
  const stat = await lstat(source).catch(() => null)
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== expected.bytes) throw new Error(`${expected.kind}_INPUT_SIZE: ${source}`)
  if (await sha256(source) !== expected.sha256) throw new Error(`${expected.kind}_INPUT_HASH: ${source}`)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
}

export async function buildPack({ model, runtime, out }, expected = expectedContract) {
  if (!model || !runtime || !out) throw new Error('build requires --model, --runtime and --out')
  const output = resolve(out)
  if (existsSync(output)) throw new Error(`OUTPUT_EXISTS: ${output}`)
  await mkdir(output, { recursive: false })
  try {
    for (const file of contractFiles(expected)) {
      let source
      if (file.kind === 'MODEL') source = resolve(model)
      else if (file.kind === 'RUNTIME') source = join(resolve(runtime), file.path.slice(`${expected.runtime.relativePath}/`.length))
      else if (file.path === 'legal/LICENSE-LLVM-OpenMP') source = join(resolve(runtime), 'LICENSE-LLVM-OpenMP')
      else source = join(repositoryRoot, legalSources.get(file.path) ?? '')
      await verifiedCopy(source, join(output, ...file.path.split('/')), file)
    }
    await writeFile(join(output, 'manifest.json'), `${JSON.stringify(expected, null, 2)}\n`, { flag: 'wx' })
    const inventory = await verifyPack(output, expected)
    const reportPath = `${output}.ai-pack-inventory.json`
    await writeFile(reportPath, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' })
    return { output, reportPath, inventory }
  } catch (error) {
    throw new Error(`BUILD_FAILED (partial output left for inspection, never trusted): ${error.message}`)
  }
}

function argumentsFor(argv) {
  const [command, ...rest] = argv; const values = {}
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index]?.startsWith('--') || rest[index + 1] === undefined) throw new Error(`Invalid argument: ${rest[index] ?? ''}`)
    values[rest[index].slice(2)] = rest[index + 1]
  }
  return { command, values }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { command, values } = argumentsFor(process.argv.slice(2))
    if (command === 'verify') {
      if (!values.pack) throw new Error('verify requires --pack')
      const result = await verifyPack(values.pack)
      console.log(`PASS GreekGod Offline AI Pack ${result.packVersion}: ${result.files.length} trusted files`)
    } else if (command === 'build') {
      const result = await buildPack(values)
      console.log(`PASS built and verified: ${result.output}`)
      console.log(`Inventory: ${result.reportPath}`)
    } else throw new Error('Usage: ai-pack-tool.mjs build --model <gguf> --runtime <dir> --out <dir> | verify --pack <dir>')
  } catch (error) {
    console.error(`FAIL ${error.message}`)
    process.exitCode = 1
  }
}
