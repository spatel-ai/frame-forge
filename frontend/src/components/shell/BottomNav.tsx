import { NavLinks } from './NavLinks'
import { enabledNavItems, type NavItem } from './navItems'
import styles from './BottomNav.module.css'

/** Fixed bottom bar below 768 px; absent from 768 px up. Named differently from the sidebar so the two are distinguishable. */
export function BottomNav({ items }: { items?: NavItem[] }) {
  return (
    <nav aria-label="Main (phone)" className={styles.bar}>
      <NavLinks items={enabledNavItems(items)} iconSize={22} linkClass={styles.link} activeClass={styles.active} labelClass={styles.label} />
    </nav>
  )
}
