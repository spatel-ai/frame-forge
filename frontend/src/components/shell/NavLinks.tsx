import { NavLink } from 'react-router'
import type { NavItem } from './navItems'

/** One NavLink per item. NavLink sets aria-current="page" on the current one, also on child routes. */
export function NavLinks({ items, iconSize, linkClass, activeClass, labelClass }: {
  items: NavItem[]
  iconSize: number
  linkClass: string
  activeClass: string
  labelClass: string
}) {
  return (
    <>
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} title={label} end={to === '/'} className={({ isActive }) => (isActive ? `${linkClass} ${activeClass}` : linkClass)}>
          <Icon size={iconSize} />
          <span className={labelClass}>{label}</span>
        </NavLink>
      ))}
    </>
  )
}
