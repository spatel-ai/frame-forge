import { MutationCache, QueryCache, QueryClient, useQuery } from '@tanstack/react-query'
import type { createBrowserRouter } from 'react-router'
import { ApiError, getMe, meKey } from '../api/client'
import type { User } from '../api/client'
import { storeId } from './jobStorage'

const RETRY_MS = 3000
const ME_STALE_MS = 60_000

/** A 401 `not_authenticated`: the session is missing or has expired. (`invalid_credentials` is not.) */
export const isSessionExpired = (e: unknown) =>
  e instanceof ApiError && e.status === 401 && e.code === 'not_authenticated'

export const loginPath = (next: string) => `/login?next=${encodeURIComponent(next)}`

/** The logged-in user, or null when logged out. Network and server errors stay errors. */
export function useMe() {
  return useQuery<User | null>({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return await getMe()
      } catch (e) {
        if (isSessionExpired(e)) return null
        throw e
      }
    },
    retry: false,
    staleTime: ME_STALE_MS,
    // 'always': coming back from confirming the email in another tab must refresh even within staleTime.
    refetchOnWindowFocus: 'always',
    // No user loaded yet and the server could not be reached: try again every few seconds.
    refetchInterval: (q) => (q.state.error && q.state.data === undefined ? RETRY_MS : false),
    refetchIntervalInBackground: true,
  })
}

type RouterLike = Pick<ReturnType<typeof createBrowserRouter>, 'state' | 'navigate'>

/**
 * The app's QueryClient. When any query or mutation fails with 401 `not_authenticated`, it forgets all
 * cached server data and the stored job id, then sends the person to log in, remembering where they were.
 */
export function createQueryClient(getRouter: () => RouterLike): QueryClient {
  const onError = (error: unknown) => {
    if (!isSessionExpired(error)) return
    const router = getRouter()
    const { pathname, search } = router.state.location
    if (pathname === '/login') return // already there: no loop
    storeId(null)
    client.clear()
    void router.navigate(loginPath(pathname + search), { replace: true })
  }
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
  })
  return client
}
