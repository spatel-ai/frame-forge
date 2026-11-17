import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router'
import { ApiError, meKey } from '../../api/client'
import { storeId } from '../../lib/jobStorage'
import { safeNext } from '../../lib/validation'
import { errMsg } from '../../lib/util'
import { loginPath, useMe } from '../../lib/session'
import { Banner, Skeleton, SkeletonGroup } from '../feedback'
import { Button } from '../form'
import styles from './RequireAuth.module.css'

type Problem = { error: unknown; retry: () => void; retrying: boolean; loginTo: string }

function PageSkeleton({ problem }: { problem?: Problem | null }) {
  // A reply with a status (500 and the like) is a server fault; no reply at all is a connection problem.
  const serverFault = problem?.error instanceof ApiError
  return (
    <div className={styles.page}>
      {problem && (
        <Banner
          tone="warning"
          title={serverFault ? `The server had a problem (${errMsg(problem.error)}). Retrying…` : `Cannot reach the server (${errMsg(problem.error)}). Retrying…`}
          action={
            <div className={styles.actions}>
              <Button variant="secondary" busy={problem.retrying} onClick={problem.retry}>Try again</Button>
              <Link to={problem.loginTo} className={styles.loginLink}>Log in again</Link>
            </div>
          }
        />
      )}
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
  const { data: me, error, refetch, isFetching } = useMe()
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
  return (
    <PageSkeleton
      problem={error ? { error, retry: () => void refetch(), retrying: isFetching, loginTo: loginPath(location.pathname + location.search) } : null}
    />
  )
}

/** /login and /signup: a logged-in user goes on to `next` (default /create). Others see the page at once. */
export function RedirectIfLoggedIn({ children }: { children: ReactNode }) {
  const { data: me } = useMe()
  const [params] = useSearchParams()
  if (me) return <Navigate to={safeNext(params.get('next'))} replace />
  return <>{children}</>
}
