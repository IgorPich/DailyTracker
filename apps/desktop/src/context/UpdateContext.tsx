import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useToast } from './ToastContext'
import {
  checkForUpdates,
  getUpdateStatus,
  registerUpdateCloseHandler,
  subscribeToUpdates,
  type UpdateStatus,
} from '../services/updateService'

interface UpdateContextValue extends UpdateStatus {
  checkNow(): Promise<void>
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState(getUpdateStatus)
  const announcedVersion = useRef<string>()
  const { showToast } = useToast()

  useEffect(() => subscribeToUpdates(setStatus), [])

  useEffect(() => {
    let active = true
    let unregister: () => void = () => undefined
    void registerUpdateCloseHandler().then((cleanup) => {
      if (active) unregister = cleanup
      else cleanup()
    })
    void checkForUpdates()
    return () => {
      active = false
      unregister()
    }
  }, [])

  useEffect(() => {
    if (status.phase !== 'ready' || !status.availableVersion || announcedVersion.current === status.availableVersion) return
    announcedVersion.current = status.availableVersion
    showToast(`GreekGod ${status.availableVersion} jest gotowy i zostanie zainstalowany po zamknięciu aplikacji.`, 'info', 8_000)
  }, [showToast, status.availableVersion, status.phase])

  const checkNow = useCallback(() => checkForUpdates(true), [])
  const value = useMemo(() => ({ ...status, checkNow }), [checkNow, status])

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
}

export const useUpdate = () => {
  const context = useContext(UpdateContext)
  if (!context) throw new Error('useUpdate must be used inside UpdateProvider')
  return context
}
