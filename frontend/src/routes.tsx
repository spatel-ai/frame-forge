import { Navigate } from 'react-router'
import type { RouteObject } from 'react-router'
import AppShell from './components/AppShell'
import NotFound from './components/NotFound'
import { RedirectIfLoggedIn, RequireAuth } from './components/shell/RequireAuth'
import { authRoutes } from './features/auth/routes'
import AccountPage from './features/account/AccountPage'
import CreatePage from './features/create/CreatePage'
import JobPage from './features/create/JobPage'

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
      { index: true, element: <Navigate to="/create" replace /> },
      { path: 'create', element: <CreatePage /> },
      { path: 'create/:jobId', element: <JobPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]
