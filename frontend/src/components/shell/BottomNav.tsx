import { useEffect, useState } from 'react'
import { matchPath, NavLink, useLocation } from 'react-router'
import { Dialog } from '../feedback'
import { NavLinks } from './NavLinks'
import { enabledNavItems, type NavItem } from './navItems'
import styles from './BottomNav.module.css'

/** Three dots, kept here because the shared icon set has no "More" icon. */
function MoreIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}

/**
 * Fixed bottom bar below 768 px; absent from 768 px up. Named differently from the sidebar so the two are
 * distinguishable. Shows the items flagged `phonePrimary` and a "More" button for the rest.
 */
export function BottomNav({ items }: { items?: NavItem[] }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const enabled = enabledNavItems(items)
  const primary = enabled.filter((i) => i.phonePrimary)
  const overflow = enabled.filter((i) => !i.phonePrimary)
  const moreCurrent = overflow.some((i) => matchPath({ path: i.to, end: false }, pathname))

  // The bar is gone from 768 px up: close the sheet then, and leave focus on the page content.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = (e: MediaQueryListEvent) => {
      if (!e.matches) return
      setOpen(false)
      requestAnimationFrame(() => {
        if (!document.activeElement || document.activeElement === document.body) document.getElementById('content')?.focus()
      })
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Keep the page behind the open sheet from scrolling (WebKit scrolls it otherwise).
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const before = root.style.overflow
    root.style.overflow = 'hidden'
    return () => { root.style.overflow = before }
  }, [open])

  return (
    <>
      <nav aria-label="Main (phone)" className={styles.bar}>
        <NavLinks items={primary} iconSize={22} linkClass={styles.link} activeClass={styles.active} labelClass={styles.label} />
        {overflow.length > 0 && (
          <button
            type="button"
            className={moreCurrent ? `${styles.link} ${styles.active}` : styles.link}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <MoreIcon size={22} />
            <span className={styles.label}>More</span>
          </button>
        )}
      </nav>
      <Dialog open={open} onClose={() => setOpen(false)} title="More">
        <ul className={styles.sheetList}>
          {overflow.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) => (isActive ? `${styles.sheetLink} ${styles.sheetActive}` : styles.sheetLink)}
                onClick={() => setOpen(false)}
              >
                <Icon size={22} />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  )
}
