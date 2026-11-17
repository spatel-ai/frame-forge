import type { RouteObject } from 'react-router'
import AppShell from './components/AppShell'
import NotFound from './components/NotFound'
import { RedirectIfLoggedIn, RequireAuth } from './components/shell/RequireAuth'
import { authRoutes } from './features/auth/routes'
import AccountPage from './features/account/AccountPage'
import CreatePage from './features/create/CreatePage'
import JobPage from './features/create/JobPage'
import HomePage from './features/home/HomePage'
import VideoDetailPage from './features/videos/VideoDetailPage'
import VideosPage from './features/videos/VideosPage'
import WalletPage from './features/wallet/WalletPage'

// /verify-email and /reset-password work logged in or out; only /login and /signup send a user on.
const SEND_ON = ['/login', '/signup']
const auth: RouteObject[] = authRoutes.map((r) =>
  r.path && SEND_ON.includes(r.path) ? { ...r, element: <RedirectIfLoggedIn>{r.element}</RedirectIfLoggedIn> } : r,
)

export const routes: RouteObject[] = [
  ...auth,
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'create', element: <CreatePage /> },
      { path: 'create/:jobId', element: <JobPage /> },
      { path: 'videos', element: <VideosPage /> },
      { path: 'videos/:jobId', element: <VideoDetailPage /> },
      { path: 'wallet', element: <WalletPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]
