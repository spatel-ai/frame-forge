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
 * On very short screens (max-height 420px, e.g. a phone held sideways with the keyboard open) the
 * row is not pinned, so it does not cover half the screen; the fade then shows there is more below.
 *
 * Space for a pinned footer: the Dialog finds the pinned footer inside its body (DialogActions, or
 * a feature's own bar with `position: sticky; bottom: 0`; mark a bar pinned another way with
 * `data-dialog-footer`), sets `--dialog-footer-space` on the scroll container to its height plus a
 * small gap (0 when nothing is pinned), and scrolls a focused field clear of it: on focus, and when
 * the body shrinks (the on-screen keyboard opening, rotation). Features need no change to benefit;
 * they may read the property (e.g. for padding) but should not set it.
 */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions} data-dialog-footer="">{children}</div>
}

/** True while the scroll container has content below its visible area. */
function hasMoreBelow(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight > 1
}

/**
 * The pinned footers in the body. A footer is an element
 * marked `data-dialog-footer`, or any element pinned with `position: sticky; bottom: 0` (so a
 * feature's own sticky button bar counts without changes).
 */
function findFooters(body: HTMLElement): HTMLElement[] {
  return [...body.querySelectorAll<HTMLElement>('*')].filter((el) => {
    const style = getComputedStyle(el)
    return style.position === 'sticky' && (el.hasAttribute('data-dialog-footer') || style.bottom === '0px')
  })
}

/** Extra room kept between a focused field and the pinned footer, in px. */
const FOOTER_GAP = 8

/**
 * Backdrop presses in the first moments after opening are ignored, and the second click of the
 * opening double-click/double-tap is swallowed, so a quick double press on the opener does not
 * close the dialog again or press whatever is under the finger.
 */
const OPEN_GUARD_MS = 300
/** A press this close to the opener's press (px) during the guard counts as part of the opening gesture. */
const SAME_SPOT_PX = 24

type Press = { x: number; y: number; time: number }

/** The last real (trusted) pointer press anywhere on the page: where the opener was pressed. */
let lastPagePress: Press | null = null
let pressListeners = 0
const recordPress = (event: PointerEvent) => {
  if (event.isTrusted) lastPagePress = { x: event.clientX, y: event.clientY, time: performance.now() }
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
  const openedAt = useRef(0)
  const openerPress = useRef<Press | null>(null)
  /** The current press inside the dialog: did it start on the backdrop, and was it part of opening? */
  const press = useRef({ onBackdrop: false, openingGesture: false })

  useEffect(() => {
    if (pressListeners++ === 0) document.addEventListener('pointerdown', recordPress, true)
    return () => {
      if (--pressListeners === 0) document.removeEventListener('pointerdown', recordPress, true)
    }
  }, [])

  // Show the bottom fade only while more of the body is below the fold. Re-checked on scroll and
  // whenever the body or its content changes size (errors appearing, rotation, keyboard).
  useEffect(() => {
    const scroller = scrollerRef.current
    const body = bodyRef.current
    if (!open || !scroller || !body) return
    const update = () => scroller.toggleAttribute('data-more-below', hasMoreBelow(body))
    // Keep the scroll padding equal to the pinned footer, and when the body shrinks (the on-screen
    // keyboard opening, rotation) bring the focused field back above the footer.
    let space = 0
    let footers: HTMLElement[] = []
    // Engines differ in whether focus scrolling honours scroll-padding, so check it ourselves too.
    const keepFocusedClear = () => {
      const focused = document.activeElement
      if (!space || !(focused instanceof HTMLElement) || !body.contains(focused)) return
      // A button in the footer is always in view; moving the body for it would jump the content.
      if (footers.some((footer) => footer.contains(focused))) return
      // A visually hidden control (the file input of a drop zone) is shown by its label.
      const labels = focused instanceof HTMLInputElement ? focused.labels : null
      const shown = focused.offsetHeight <= 2 && labels && labels.length > 0 ? labels[labels.length - 1] : focused
      const box = body.getBoundingClientRect()
      const field = shown.getBoundingClientRect()
      // Bring its bottom above the footer, but never push its top out of view (a tall textarea).
      const overlap = Math.min(field.bottom - (box.bottom - space - FOOTER_GAP), field.top - box.top)
      if (overlap > 0) body.scrollTop += overlap
    }
    const relayout = () => {
      footers = findFooters(body)
      space = footers.reduce((max, footer) => Math.max(max, footer.offsetHeight), 0)
      body.style.setProperty('--dialog-footer-space', `${space ? space + FOOTER_GAP : 0}px`)
      keepFocusedClear()
      update()
    }
    // After the browser's own focus scrolling has run.
    const onFocusIn = () => requestAnimationFrame(keepFocusedClear)
    relayout()
    body.addEventListener('scroll', update, { passive: true })
    body.addEventListener('focusin', onFocusIn)
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(relayout)
      observer.observe(body)
      if (contentRef.current) observer.observe(contentRef.current)
    }
    return () => {
      body.removeEventListener('scroll', update)
      body.removeEventListener('focusin', onFocusIn)
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
      openedAt.current = performance.now()
      openerPress.current = lastPagePress && openedAt.current - lastPagePress.time < 1000 ? lastPagePress : null
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
      onPointerDownCapture={(event) => {
        const inGuard = performance.now() - openedAt.current < OPEN_GUARD_MS
        const near = openerPress.current
        press.current = {
          // A press counts for the backdrop only if it started there, after the guard: a drag that
          // ends on the backdrop or the tail of the opening double-click never closes the dialog.
          onBackdrop: !inGuard && event.target === event.currentTarget,
          openingGesture:
            inGuard &&
            event.nativeEvent.isTrusted &&
            near !== null &&
            Math.hypot(event.clientX - near.x, event.clientY - near.y) <= SAME_SPOT_PX,
        }
      }}
      onClickCapture={(event) => {
        // The second click of the double-click/double-tap that opened the dialog: swallow it, so it
        // neither closes the dialog nor presses the control under the same spot. Keyboard clicks
        // (detail 0) are never swallowed.
        const inGuard = performance.now() - openedAt.current < OPEN_GUARD_MS
        if (inGuard && event.detail > 0 && (event.detail >= 2 || press.current.openingGesture)) {
          event.preventDefault()
          event.stopPropagation()
          press.current = { onBackdrop: false, openingGesture: false }
        }
      }}
      onClick={(event) => {
        const fromBackdrop = press.current.onBackdrop
        press.current = { onBackdrop: false, openingGesture: false }
        if (dismissable && fromBackdrop && event.target === event.currentTarget) onClose()
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
