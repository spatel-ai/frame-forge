import { Logo } from './Logo'
import { NavLinks } from './NavLinks'
import { enabledNavItems, type NavItem } from './navItems'
import styles from './Sidebar.module.css'

/** Sidebar from 768 px; icons only from 768 to 1023 px (the label stays as hidden text); absent below 768 px. */
export function Sidebar({ items }: { items?: NavItem[] }) {
  return (
    <nav aria-label="Main" className={styles.sidebar}>
      <div className={styles.brand}><Logo collapseOnTablet /></div>
      <NavLinks items={enabledNavItems(items)} iconSize={20} linkClass={styles.link} activeClass={styles.active} labelClass={styles.label} />
    </nav>
  )
}
