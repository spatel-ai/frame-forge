import { useEffect } from 'react'
import { matchPath, useLocation } from 'react-router'

const TITLES: { path: string; title: string; end?: boolean }[] = [
  { path: '/', title: 'Home', end: true },
  { path: '/create', title: 'Create a video' },
  { path: '/videos', title: 'Videos' },
  { path: '/scripts', title: 'Scripts' },
  { path: '/banners', title: 'Banners' },
  { path: '/wallet', title: 'Wallet' },
  { path: '/account', title: 'Account' },
]

export const APP_NAME = 'Frameforge'

export function pageTitle(pathname: string): string {
  const hit = TITLES.find((t) => matchPath({ path: t.path, end: t.end ?? false }, pathname))
  return `${hit ? hit.title : 'Page not found'} · ${APP_NAME}`
}

/** Sets the browser tab title for the logged-in pages. The next page sets its own; nothing is restored. */
export function usePageTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = pageTitle(pathname)
  }, [pathname])
}
