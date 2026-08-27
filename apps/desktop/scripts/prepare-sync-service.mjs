import { copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const repositoryRoot = resolve(desktopDirectory, '..', '..')
const serviceManifest = resolve(repositoryRoot, 'apps', 'sync-service', 'Cargo.toml')

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
  return result.stdout
}

const rustVersion = run('rustc', ['-vV'])
const targetTriple = /^host:\s+(\S+)$/m.exec(rustVersion)?.[1]
if (!targetTriple) throw new Error('Could not determine the Rust host target triple.')
if (targetTriple !== 'x86_64-pc-windows-msvc') {
  throw new Error(`Windows bundle requires x86_64-pc-windows-msvc, received ${targetTriple}.`)
}

run('cargo', ['build', '--locked', '--release', '--manifest-path', serviceManifest])

const source = resolve(repositoryRoot, 'apps', 'sync-service', 'target', 'release', 'greekgod-sync-service.exe')
const destination = resolve(
  desktopDirectory,
  'src-tauri',
  'binaries',
  `greekgod-sync-service-${targetTriple}.exe`,
)
const temporaryDestination = `${destination}.tmp`
mkdirSync(dirname(destination), { recursive: true })
rmSync(temporaryDestination, { force: true })
copyFileSync(source, temporaryDestination)
rmSync(destination, { force: true })
renameSync(temporaryDestination, destination)

process.stdout.write(`Prepared Sync Service sidecar: ${destination}\n`)
