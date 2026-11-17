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
  // Log-in screens (outside the app shell; AuthLayout calls the hook). The sent page comes before its parent.
  { path: '/login', title: 'Log in' },
  { path: '/signup', title: 'Sign up' },
  { path: '/forgot-password/sent', title: 'Check your email' },
  { path: '/forgot-password', title: 'Forgot password' },
  { path: '/reset-password', title: 'Reset password' },
  { path: '/verify-email', title: 'Confirm your email' },
]

export const APP_NAME = 'Frameforge'

export function pageTitle(pathname: string): string {
  const hit = TITLES.find((t) => matchPath({ path: t.path, end: t.end ?? false }, pathname))
  return `${hit ? hit.title : 'Page not found'} · ${APP_NAME}`
}

/** Sets the browser tab title for the logged-in pages and the log-in screens. The next page sets its own; nothing is restored. */
export function usePageTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = pageTitle(pathname)
  }, [pathname])
}
