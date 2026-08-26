import { createServer } from 'vite'

const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  await server.ssrLoadModule('/scripts/storage/legacyAppDataStore.test.ts')
  await server.ssrLoadModule('/scripts/storage/nativeShadowAppDataStore.test.ts')
  await server.ssrLoadModule('/scripts/storage/sqliteAppDataStore.test.ts')
  await server.ssrLoadModule('/scripts/storage/storageMigration.test.ts')
} finally {
  await server.close()
}
