import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppDataStore } from '@greekgod/core'
import { createCloseLifecycle, UPDATE_INSTALL_EXIT_FALLBACK_MS } from '../src/services/closeLifecycle.ts'
import { TrackedAppDataStore } from '../src/services/trackedAppDataStore.ts'

const deferred = () => {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const event = () => {
  let prevented = 0
  return { preventDefault: () => { prevented += 1 }, prevented: () => prevented }
}

test('ordinary close seals writes, flushes the pending write, then destroys the window', async () => {
  const pendingWrite = deferred()
  let saves = 0
  const delegate = {
    load: async () => ({} as Awaited<ReturnType<AppDataStore['load']>>),
    save: () => { saves += 1; return pendingWrite.promise },
    backupBeforeImport: async () => undefined,
  } satisfies AppDataStore
  const store = new TrackedAppDataStore(delegate)
  const firstWrite = store.save({} as never)
  const calls: string[] = []
  const handleClose = createCloseLifecycle({
    beginShutdown: () => { calls.push('begin-shutdown'); return store.beginShutdown() },
    getStagedUpdate: () => undefined,
    destroyWindow: async () => { calls.push('destroy') },
    reportFailure: () => assert.fail('ordinary close must not report a failure'),
  })

  const closeEvent = event()
  const closing = handleClose(closeEvent)
  await assert.rejects(store.save({} as never), /no longer accepts data writes/)
  assert.equal(saves, 1)
  assert.deepEqual(calls, ['begin-shutdown'])
  pendingWrite.resolve()
  await firstWrite
  await closing
  assert.deepEqual(calls, ['begin-shutdown', 'destroy'])
  assert.equal(closeEvent.prevented(), 1)
})

test('staged update starts only after flush and repeated close events are idempotent', async () => {
  const flushed = deferred()
  const installStarted = deferred()
  const calls: string[] = []
  let fallbackDelay: number | undefined
  let cancelCount = 0
  const handleClose = createCloseLifecycle({
    beginShutdown: () => { calls.push('begin-shutdown'); return flushed.promise },
    getStagedUpdate: () => ({
      install: async (options) => {
        calls.push(`install:${options.restartAfterInstall}`)
        installStarted.resolve()
      },
    }),
    destroyWindow: async () => { calls.push('destroy') },
    reportFailure: () => assert.fail('successful update close must not report a failure'),
    scheduleExitFallback: (_callback, delayMs) => {
      fallbackDelay = delayMs
      return () => { cancelCount += 1 }
    },
  })

  const firstEvent = event()
  const secondEvent = event()
  const firstClose = handleClose(firstEvent)
  const secondClose = handleClose(secondEvent)
  assert.equal(firstClose, secondClose)
  assert.deepEqual(calls, ['begin-shutdown'])
  flushed.resolve()
  await installStarted.promise
  await firstClose
  assert.deepEqual(calls, ['begin-shutdown', 'install:true', 'destroy'])
  assert.equal(fallbackDelay, UPDATE_INSTALL_EXIT_FALLBACK_MS)
  assert.equal(cancelCount, 1)
  assert.equal(firstEvent.prevented(), 1)
  assert.equal(secondEvent.prevented(), 1)
})

test('a hung updater cannot keep the old Desktop process alive', async () => {
  const neverFinishes = deferred()
  let fallback!: () => void
  let destroyCount = 0
  const handleClose = createCloseLifecycle({
    beginShutdown: async () => undefined,
    getStagedUpdate: () => ({ install: () => neverFinishes.promise }),
    destroyWindow: async () => { destroyCount += 1 },
    reportFailure: () => undefined,
    scheduleExitFallback: (callback) => { fallback = callback; return () => undefined },
  })

  void handleClose(event())
  await Promise.resolve()
  fallback()
  await Promise.resolve()
  assert.equal(destroyCount, 1)
  neverFinishes.resolve()
})

test('flush or updater failure reports the stage and still destroys exactly once', async () => {
  for (const failureStage of ['flush', 'install'] as const) {
    const failures: string[] = []
    let destroyCount = 0
    const handleClose = createCloseLifecycle({
      beginShutdown: failureStage === 'flush' ? async () => { throw new Error('write failed') } : async () => undefined,
      getStagedUpdate: () => failureStage === 'install'
        ? { install: async () => { throw new Error('install failed') } }
        : undefined,
      destroyWindow: async () => { destroyCount += 1 },
      reportFailure: (stage) => failures.push(stage),
      scheduleExitFallback: () => () => undefined,
    })

    await handleClose(event())
    assert.deepEqual(failures, [failureStage])
    assert.equal(destroyCount, 1)
  }
})
