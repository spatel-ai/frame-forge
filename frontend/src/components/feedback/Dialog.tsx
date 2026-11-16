import { useEffect, useId, useRef, type ReactNode } from 'react'
import { CloseIcon } from '../icons'
import styles from './Dialog.module.css'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Backdrop click closes the dialog. Default true. */
  dismissable?: boolean
}

export function Dialog({ open, onClose, title, children, dismissable = true }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
      if (!dialog.contains(document.activeElement)) closeRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
      opener.current?.focus()
      opener.current = null
    }
  }, [open])

  const openRef = useRef(open)
  openRef.current = open

  // Closing is always driven by the open prop: Escape asks the parent to close, it does not close itself.
  // Browsers may skip the cancellable 'cancel' event (e.g. repeated Escape without user activation) and
  // close the dialog natively; the 'close' listener then tells the parent so the prop never goes stale.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const onCancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }
    const onNativeClose = () => {
      if (openRef.current) onClose()
    }
    dialog.addEventListener('cancel', onCancel)
    dialog.addEventListener('close', onNativeClose)
    return () => {
      dialog.removeEventListener('cancel', onCancel)
      dialog.removeEventListener('close', onNativeClose)
    }
  }, [onClose])

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (dismissable && event.target === event.currentTarget) onClose()
      }}
    >
      {open && (
        <div className={styles.panel}>
          <div className={styles.header}>
            <h2 id={titleId} className={styles.title}>{title}</h2>
            <button ref={closeRef} type="button" className={styles.close} aria-label="Close" onClick={onClose}>
              <CloseIcon size={20} />
            </button>
          </div>
          <div className={styles.body}>{children}</div>
        </div>
      )}
    </dialog>
  )
}
