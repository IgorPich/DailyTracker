import { createServer } from 'vite'

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  await server.ssrLoadModule('/scripts/storage/legacyAppDataStore.test.ts')
} finally {
  await server.close()
}
