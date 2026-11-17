import type { ComponentType } from 'react'
import { HomeIcon, PlusCircleIcon, ScriptIcon, UploadIcon, UserIcon, VideoIcon, WalletIcon, type IconProps } from '../icons'

export type NavItem = {
  to: string
  label: string
  icon: ComponentType<IconProps>
  /** Only enabled items render. A later milestone switches one on when its page and API exist. */
  enabled: boolean
  /** Shown directly in the phone bottom bar. Enabled items without it go in the "More" sheet on phones. */
  phonePrimary?: boolean
}

// M1.5: only Create exists. The other designed items stay here, switched off,
// so a later milestone flips one flag instead of rebuilding the navigation.
export const navItems: NavItem[] = [
  { to: '/', label: 'Home', icon: HomeIcon, enabled: true, phonePrimary: true },
  { to: '/create', label: 'Create', icon: PlusCircleIcon, enabled: true, phonePrimary: true },
  { to: '/videos', label: 'Videos', icon: VideoIcon, enabled: true, phonePrimary: true },
  { to: '/scripts', label: 'Scripts', icon: ScriptIcon, enabled: true },
  { to: '/banners', label: 'Banners', icon: UploadIcon, enabled: true },
  { to: '/wallet', label: 'Wallet', icon: WalletIcon, enabled: true, phonePrimary: true },
  { to: '/account', label: 'Account', icon: UserIcon, enabled: true },
]

export const enabledNavItems = (items: NavItem[] = navItems): NavItem[] => items.filter((i) => i.enabled)
