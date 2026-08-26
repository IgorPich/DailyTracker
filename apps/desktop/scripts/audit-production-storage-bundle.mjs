import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = join(desktopRoot, 'dist')

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(path) : [path]
  }))
  return nested.flat()
}

const sourceFiles = (await collectFiles(distRoot))
  .filter((path) => ['.js', '.html'].includes(extname(path)))
const productionBundle = (await Promise.all(sourceFiles.map((path) => readFile(path, 'utf8')))).join('\n')

for (const forbidden of [
  'native_storage_probe',
  'native_shadow_replace',
  'native_shadow_load',
  'native_shadow_backup_before_import',
  'native_sqlite_smoke_exit',
  'SQLITE_WEBVIEW_SMOKE_PASS',
]) {
  assert.doesNotMatch(productionBundle, new RegExp(forbidden), `production bundle contains ${forbidden}`)
}

console.log('PASS production storage bundle: Legacy composition contains no native SQLite command path')
