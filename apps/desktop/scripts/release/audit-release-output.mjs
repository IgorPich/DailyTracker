import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const secretValues = [process.env.TAURI_SIGNING_PRIVATE_KEY, process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD]
if (secretValues.some((value) => !value)) throw new Error('Signing secret audit requires both Tauri signing environment variables.')

const privateKeyNeedles = secretValues[0].split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 32 && !line.startsWith('untrusted comment:'))
const needles = [...privateKeyNeedles, secretValues[1]].map((value) => Buffer.from(value))
const tokenPatterns = [/github_pat_[A-Za-z0-9_]{20,}/, /gh[pousr]_[A-Za-z0-9]{20,}/, /GITHUB_TOKEN/]
const files = []
const collect = (path) => {
  const stats = statSync(path)
  if (stats.isFile()) files.push(path)
  else for (const entry of readdirSync(path)) collect(resolve(path, entry))
}
for (const path of process.argv.slice(2)) collect(resolve(path))

for (const path of files) {
  const contents = readFileSync(path)
  if (needles.some((needle) => contents.includes(needle))) throw new Error(`Signing material leaked into generated output: ${path}`)
  const text = contents.toString('latin1')
  if (tokenPatterns.some((pattern) => pattern.test(text))) throw new Error(`GitHub token pattern found in generated output: ${path}`)
}
process.stdout.write(`PASS generated-output secret audit (${files.length} files)\n`)
