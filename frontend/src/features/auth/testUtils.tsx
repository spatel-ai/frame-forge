import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { User } from '../../api/client'
import { authRoutes } from './routes'

export const testUser: User = {
  id: 'u1',
  name: 'Asha Verma',
  email: 'asha@example.com',
  email_verified: false,
  role: 'user',
  active_sessions: 1,
} as User

/** Where the router is now, as `/path?query`. */
export const at = (router: ReturnType<typeof createMemoryRouter>) => router.state.location.pathname + router.state.location.search

/** Render the auth routes in a memory router with stand-ins for the pages the screens navigate to. */
export function renderAuth(
  entry: string | { pathname: string; search?: string; state?: unknown },
  { strict = false }: { strict?: boolean } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      ...authRoutes,
      { path: '/create', element: <p>create page</p> },
      { path: '/videos', element: <p>videos page</p> },
    ],
    { initialEntries: [entry] },
  )
  const ui = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  render(strict ? <StrictMode>{ui}</StrictMode> : ui)
  const u = userEvent.setup()
  return { router, queryClient, u }
}
