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

const allFiles = await collectFiles(distRoot)
const sourceFiles = allFiles
  .filter((path) => ['.js', '.html'].includes(extname(path)))
const productionBundle = (await Promise.all(sourceFiles.map((path) => readFile(path, 'utf8')))).join('\n')

for (const required of [
  'native_storage_probe',
  'native_authority_status',
  'native_authority_bootstrap',
  'native_authority_load',
  'native_authority_replace',
  'native_authority_backup_before_import',
]) {
  assert.match(productionBundle, new RegExp(required), `production bundle is missing ${required}`)
}

for (const forbidden of [
  'native_shadow_replace',
  'native_shadow_load',
  'native_shadow_backup_before_import',
  'native_sqlite_smoke_exit',
  'SQLITE_WEBVIEW_SMOKE_PASS',
  'FakeCompanionModel',
  'Fake — wyłącznie testy',
  'Ollama Development Runtime',
  'http://127.0.0.1:11434',
  'Pamięć — inspekcja',
  'Reakcje — diagnostyka',
  'schema8-physical-smoke',
  'companion-product-ux-smoke',
  'api.openai.com',
  'api.anthropic.com',
]) {
  assert.doesNotMatch(productionBundle, new RegExp(forbidden), `production bundle contains ${forbidden}`)
}

for (const path of allFiles) {
  assert.doesNotMatch(path, /\.gguf$|llama-server(?:\.exe)?$|ggml(?:-[^\\/]+)?\.dll$|physical-smoke/i,
    `production web bundle contains an external runtime/model/smoke artifact: ${path}`)
}

console.log('PASS production bundle: authoritative SQLite composition; no dev provider, smoke, cloud, model or runtime artifacts')
