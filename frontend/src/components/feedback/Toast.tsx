import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CloseIcon } from '../icons'
import styles from './Toast.module.css'
import { toneIcons, type Tone } from './tone'

const DEFAULT_DURATION = 5000
const MAX_VISIBLE = 3

export interface ToastOptions {
  tone?: Tone
  message: string
  action?: { label: string; onClick: () => void }
  /** Milliseconds before auto-dismiss. Default 5000. */
  duration?: number
}

interface ToastEntry extends ToastOptions {
  id: number
}

interface ToastApi {
  show: (options: ToastOptions) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside a ToastProvider')
  return api
}

function ToastItem({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: number) => void }) {
  const tone = toast.tone ?? 'neutral'
  const Icon = toneIcons[tone]
  const remaining = useRef(toast.duration ?? DEFAULT_DURATION)
  const startedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const start = useCallback(() => {
    clearTimeout(timer.current)
    startedAt.current = Date.now()
    timer.current = setTimeout(() => onDismiss(toast.id), remaining.current)
  }, [onDismiss, toast.id])

  const pause = useCallback(() => {
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
  }, [])

  useEffect(() => {
    start()
    return () => clearTimeout(timer.current)
  }, [start])

  return (
    <div className={styles.toast} onMouseEnter={pause} onMouseLeave={start} onFocus={pause} onBlur={start}>
      <span className={styles.icon}><Icon size={18} /></span>
      <span className={styles.message}>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            toast.action?.onClick()
            onDismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className={styles.close} aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
        <CloseIcon size={18} />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const show = useCallback((options: ToastOptions) => {
    const entry = { ...options, id: nextId.current++ }
    setToasts((current) => [...current, entry].slice(-MAX_VISIBLE))
  }, [])

  const api = useMemo(() => ({ show }), [show])
  const polite = toasts.filter((t) => t.tone !== 'danger')
  const assertive = toasts.filter((t) => t.tone === 'danger')

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region}>
        <div aria-live="polite" className={styles.stack} data-testid="toast-polite">
          {polite.map((t) => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
        </div>
        <div aria-live="assertive" className={styles.stack} data-testid="toast-assertive">
          {assertive.map((t) => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
        </div>
      </div>
    </ToastContext.Provider>
  )
}
