import { useEffect, useRef, type RefObject } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '../icons'
import styles from './Pagination.module.css'

export interface PaginationProps {
  /** Current page, counting from 1. */
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  /**
   * Optional: the element at the top of the list (its heading or the list itself). After the
   * customer presses Previous or Next and the new page arrives, it is scrolled to the top of the
   * screen (below any fixed or sticky top bar) and receives focus, so a phone user is not left at
   * the bottom of the new page and a screen-reader user hears where the new page starts. Not used
   * when the page changes for another reason (a new search, a filter, a deleted last row).
   * The element gets tabIndex -1 if it is not focusable already.
   */
  scrollTargetRef?: RefObject<HTMLElement | null>
}

/** Height covered by fixed or sticky bars at the top of the window, in px. */
function topBarHeight(): number {
  let bottom = 0
  for (const el of document.querySelectorAll<HTMLElement>('header, [role="banner"]')) {
    const { position } = getComputedStyle(el)
    if (position !== 'fixed' && position !== 'sticky') continue
    const rect = el.getBoundingClientRect()
    if (rect.top <= 0 && rect.bottom > 0) bottom = Math.max(bottom, rect.bottom)
  }
  return bottom
}

/** How long a requested page may take to arrive before the request is dropped, in ms. */
const REQUEST_TIMEOUT_MS = 10_000

/** Room left above the target after scrolling, in px. */
const TARGET_GAP = 8

function bringToTop(target: HTMLElement) {
  if (!target.hasAttribute('tabindex') && target.tabIndex < 0) target.setAttribute('tabindex', '-1')
  // A scroll-margin-top the feature set wins; otherwise keep the target clear of a pinned top bar.
  // Inside a dialog the page's top bar is not over the content, so no margin is added there.
  if (parseFloat(getComputedStyle(target).scrollMarginTop) === 0 && !target.closest('dialog')) {
    target.style.scrollMarginTop = `${topBarHeight() + TARGET_GAP}px`
  }
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  target.focus({ preventScroll: true })
}

export function Pagination({ page, pageSize, total, onPageChange, scrollTargetRef }: PaginationProps) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  // Set only by this component's own buttons, so other page changes never move scroll or focus.
  const requested = useRef<number | null>(null)
  const expiry = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (requested.current === null) return
    const arrived = requested.current === page
    // Any other page showing up means the request was superseded: forget it.
    requested.current = null
    if (!arrived) return
    const target = scrollTargetRef?.current
    if (target) bringToTop(target)
  }, [page, scrollTargetRef])

  // A page that never arrives (the request failed) must not scroll on some later, unrelated change.
  useEffect(() => () => clearTimeout(expiry.current), [])
  function go(next: number) {
    if (scrollTargetRef) {
      requested.current = next
      clearTimeout(expiry.current)
      expiry.current = setTimeout(() => { requested.current = null }, REQUEST_TIMEOUT_MS)
    }
    onPageChange(next)
  }

  return (
    <nav className={styles.nav} aria-label="Pagination">
      <p className={styles.summary}>Showing {from}–{to} of {total}</p>
      <div className={styles.buttons}>
        <button type="button" className={styles.button} disabled={page <= 1} onClick={() => go(page - 1)}>
          <ChevronLeftIcon size={18} /> Previous
        </button>
        <button type="button" className={styles.button} disabled={page >= lastPage} onClick={() => go(page + 1)}>
          Next <ChevronRightIcon size={18} />
        </button>
      </div>
    </nav>
  )
}
