import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router'
import { meKey } from '../../api/client'
import { storeId } from '../../lib/jobStorage'
import { safeNext } from '../../lib/validation'
import { errMsg } from '../../lib/util'
import { loginPath, useMe } from '../../lib/session'
import { Banner, Skeleton, SkeletonGroup } from '../feedback'
import styles from './RequireAuth.module.css'

function PageSkeleton({ error }: { error?: string | null }) {
  return (
    <div className={styles.page}>
      {error && <Banner tone="warning" title={`Cannot reach the server (${error}). Retrying…`} />}
      <SkeletonGroup label="Loading your account">
        <div className={styles.page}>
          <Skeleton shape="line" height={32} width="30%" />
          <Skeleton height={64} />
          <Skeleton height={240} />
        </div>
      </SkeletonGroup>
    </div>
  )
}

/** Routes inside the shell need a user. Logged out: go to log in, remembering the address. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, error } = useMe()
  const location = useLocation()
  const queryClient = useQueryClient()
  const loggedOut = me === null

  // Do not leak the previous user's data: drop everything cached except the (null) user.
  useEffect(() => {
    if (!loggedOut) return
    storeId(null)
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== meKey[0] })
  }, [loggedOut, queryClient])

  if (me) return <>{children}</>
  if (loggedOut) return <Navigate to={loginPath(location.pathname + location.search)} replace />
  return <PageSkeleton error={error ? errMsg(error) : null} />
}

/** /login and /signup: a logged-in user goes on to `next` (default /create). Others see the page at once. */
export function RedirectIfLoggedIn({ children }: { children: ReactNode }) {
  const { data: me } = useMe()
  const [params] = useSearchParams()
  if (me) return <Navigate to={safeNext(params.get('next'))} replace />
  return <>{children}</>
}
