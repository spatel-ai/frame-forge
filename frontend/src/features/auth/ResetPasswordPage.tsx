import { useMutation, useQuery } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ApiError, checkResetToken, NetworkError, resetPassword } from '../../api/client'
import { Banner, Skeleton, SkeletonGroup } from '../../components/feedback'
import { Button, PasswordField } from '../../components/form'
import { ChevronLeftIcon, ClockIcon, KeyIcon } from '../../components/icons'
import { AuthLayout } from './AuthLayout'
import styles from './auth.module.css'
import { useFields, validateConfirm, validateNewPassword } from '../../lib/validation'

const NETWORK_MESSAGE = 'We could not reach the server. Check your connection and try again.'

function LinkExpired() {
  return (
    <AuthLayout>
      <span className={`${styles.badge} ${styles.warning}`}><ClockIcon size={24} /></span>
      <h1 className={styles.title}>This link has expired</h1>
      <p className={styles.lead}>
        Reset links work once and only for 30 minutes. This one has been used or is too old. Ask for a new one and
        use it within 30 minutes.
      </p>
      <Link to="/forgot-password" className={styles.linkButton}>Send a new link</Link>
      <Link to="/login" className={`${styles.link} ${styles.back}`}><ChevronLeftIcon size={16} />Back to log in</Link>
    </AuthLayout>
  )
}

/** Set a new password from an emailed link (R-01). The token leaves the address bar as soon as it is read. */
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Read once on first render; later renders keep this value even though the address bar loses it.
  const [token] = useState(() => params.get('token') ?? '')
  const [expired, setExpired] = useState(!token)
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    // Keep the path and the router's own history state; drop the query string (and so the token).
    window.history.replaceState(window.history.state, '', window.location.pathname)
  }, [])

  const check = useQuery({
    queryKey: ['reset-check', token],
    queryFn: () => checkResetToken(token),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const f = useFields({ password: '', confirm: '' }, {
    password: (v) => validateNewPassword(v.password),
    confirm: (v) => validateConfirm(v.password, v.confirm),
  }, ['password', 'confirm'])

  const save = useMutation({
    mutationFn: (password: string) => resetPassword(token, password),
    onSuccess: () => navigate('/login', { replace: true }),
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'reset_link_invalid') setExpired(true)
      else if (err instanceof ApiError && err.code === 'rate_limited') setBanner(err.message)
      else if (err instanceof ApiError && f.showServerErrors({ password: err.fields.password })) setBanner(null)
      else setBanner(err instanceof NetworkError ? NETWORK_MESSAGE : err instanceof Error ? err.message : 'Something went wrong. Try again.')
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (save.isPending) return
    if (!f.checkAll()) {
      setBanner(null)
      return
    }
    save.mutate(f.values.password)
  }

  const checkInvalid = check.error instanceof ApiError && check.error.code === 'reset_link_invalid'
  if (expired || checkInvalid) return <LinkExpired />

  if (check.isError) {
    return (
      <AuthLayout>
        <h1 className={styles.title}>Set a new password</h1>
        <Banner
          tone="danger"
          title={check.error instanceof NetworkError ? NETWORK_MESSAGE : 'We could not check this link.'}
          action={<Button variant="secondary" onClick={() => void check.refetch()}>Try again</Button>}
        />
      </AuthLayout>
    )
  }

  if (!check.data) {
    return (
      <AuthLayout>
        <h1 className={styles.title}>Set a new password</h1>
        <SkeletonGroup label="Checking your link">
          <Skeleton height={44} />
          <Skeleton height={44} />
        </SkeletonGroup>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <span className={`${styles.badge} ${styles.primary}`}><KeyIcon size={24} /></span>
      <h1 className={styles.title}>Set a new password</h1>
      <p className={styles.lead}>For <strong>{check.data.email}</strong></p>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <PasswordField
          ref={f.ref('password')}
          label="New password"
          hint="At least 10 characters"
          autoComplete="new-password"
          value={f.values.password}
          error={f.error('password')}
          onChange={(e) => f.set('password', e.target.value)}
          onBlur={() => f.blur('password')}
        />
        <PasswordField
          ref={f.ref('confirm')}
          label="Type it again"
          autoComplete="new-password"
          value={f.values.confirm}
          error={f.error('confirm')}
          onChange={(e) => f.set('confirm', e.target.value)}
          onBlur={() => f.blur('confirm')}
        />
        <p className={styles.small}>After saving, you will be logged out on every device, then you can log in.</p>
        {banner && <Banner tone="danger" title={banner} />}
        <Button type="submit" size="large" block busy={save.isPending} busyLabel="Saving…">
          Save new password
        </Button>
      </form>
    </AuthLayout>
  )
}
