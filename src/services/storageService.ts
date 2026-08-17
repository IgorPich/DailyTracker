import { isTauri } from '@tauri-apps/api/core'
import type { AppData } from '../types'
import { createInitialData, normalizeData, STORAGE_KEY } from '../utils/storage'

const DESKTOP_STORE_FILE = 'formlog.store.json'
const DESKTOP_DATA_KEY = 'appData'

let desktopStorePromise: ReturnType<typeof createDesktopStore> | null = null
let saveQueue = Promise.resolve()

async function createDesktopStore() {
  const { load } = await import('@tauri-apps/plugin-store')
  return load(DESKTOP_STORE_FILE, { autoSave: false })
}

const getDesktopStore = () => {
  desktopStorePromise ??= createDesktopStore()
  return desktopStorePromise
}

export const storageService = {
  mode: (): 'tauri-store' | 'browser-local-storage' => isTauri() ? 'tauri-store' : 'browser-local-storage',

  async load(): Promise<AppData> {
    try {
      if (isTauri()) {
        const store = await getDesktopStore()
        const stored = await store.get<unknown>(DESKTOP_DATA_KEY)
        return stored === undefined ? createInitialData() : normalizeData(stored)
      }

      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? normalizeData(JSON.parse(raw)) : createInitialData()
    } catch (error) {
      console.error('Nie udało się wczytać danych Formlog.', error)
      return createInitialData()
    }
  },

  save(data: AppData): Promise<void> {
    saveQueue = saveQueue.catch(() => undefined).then(async () => {
      if (isTauri()) {
        const store = await getDesktopStore()
        await store.set(DESKTOP_DATA_KEY, data)
        await store.save()
        return
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    })
    return saveQueue
  },
}
