import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Check, Info, X } from 'lucide-react'
import { createId } from '../utils/id'

type ToastTone = 'success' | 'info'

interface ToastItem {
  id: string
  message: string
  tone: ToastTone
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = createId()
    setToasts((current) => [...current.slice(-2), { id, message, tone }])
    window.setTimeout(() => dismiss(id), 2600)
  }, [dismiss])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div className={`toast toast--${toast.tone}`} key={toast.id}>
            {toast.tone === 'success' ? <Check size={16} /> : <Info size={16} />}
            <span>{toast.message}</span>
            <button onClick={() => dismiss(toast.id)} aria-label="Zamknij komunikat"><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
