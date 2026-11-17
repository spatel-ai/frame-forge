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

/**
 * Keeps a dialog's buttons visible at the bottom of the scrolling body (sticky footer) on short
 * screens. Optional: put it inside the dialog's <form>, in place of the actions row, so the
 * buttons still submit the form. A dialog without it still shows a fade while content is below.
 */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>
}

/** True while the scroll container has content below its visible area. */
function hasMoreBelow(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight > 1
}

export function Dialog({ open, onClose, title, children, dismissable = true }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const openRef = useRef(open)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Show the bottom fade only while more of the body is below the fold. Re-checked on scroll and
  // whenever the body or its content changes size (errors appearing, rotation, keyboard).
  useEffect(() => {
    const scroller = scrollerRef.current
    const body = bodyRef.current
    if (!open || !scroller || !body) return
    const update = () => scroller.toggleAttribute('data-more-below', hasMoreBelow(body))
    update()
    body.addEventListener('scroll', update, { passive: true })
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update)
      observer.observe(body)
      if (contentRef.current) observer.observe(contentRef.current)
    }
    return () => {
      body.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [open])

  useEffect(() => {
    // Updated before close() below, so the native 'close' it fires is not reported back to the parent.
    openRef.current = open
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
          <div ref={scrollerRef} className={styles.scroller}>
            <div ref={bodyRef} className={styles.body}>
              <div ref={contentRef}>{children}</div>
            </div>
            <div className={styles.fade} aria-hidden="true" />
          </div>
        </div>
      )}
    </dialog>
  )
}
