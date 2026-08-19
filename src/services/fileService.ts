import { isTauri } from '@tauri-apps/api/core'

export const isDesktopApp = () => isTauri()

const browserDownload = (contents: BlobPart, filename: string, mime: string) => {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function saveTextExport(contents: string, filename: string, description: string, extensions: string[]) {
  if (!isTauri()) {
    browserDownload(contents, filename, extensions.includes('json') ? 'application/json' : 'text/csv;charset=utf-8')
    return true
  }

  const [{ save }, { writeTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])
  const path = await save({ defaultPath: filename, filters: [{ name: description, extensions }] })
  if (!path) return false
  await writeTextFile(path, contents)
  return true
}

export async function pickJsonText() {
  if (!isTauri()) return null
  const [{ open }, { readTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])
  const path = await open({ multiple: false, directory: false, filters: [{ name: 'GreekGod JSON', extensions: ['json'] }] })
  if (!path || Array.isArray(path)) return null
  return readTextFile(path)
}

export async function savePngDataUrl(dataUrl: string, filename: string) {
  if (!isTauri()) {
    const anchor = document.createElement('a')
    anchor.download = filename
    anchor.href = dataUrl
    anchor.click()
    return true
  }

  const [{ save }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])
  const path = await save({ defaultPath: filename, filters: [{ name: 'Obraz PNG', extensions: ['png'] }] })
  if (!path) return false
  const response = await fetch(dataUrl)
  await writeFile(path, new Uint8Array(await response.arrayBuffer()))
  return true
}

export async function confirmAction(message: string, title = 'GreekGod') {
  if (!isTauri()) return window.confirm(message)
  const { confirm } = await import('@tauri-apps/plugin-dialog')
  return confirm(message, { title, kind: 'warning' })
}
