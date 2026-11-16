import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ApiError, meKey, NetworkError, resendVerification, verifyEmail } from '../../api/client'
import type { User } from '../../api/client'
import { Banner, Skeleton, SkeletonGroup } from '../../components/feedback'
import { Button } from '../../components/form'
import { CheckIcon, ChevronLeftIcon, ClockIcon, ChevronRightIcon } from '../../components/icons'
import { AuthLayout } from './AuthLayout'
import styles from './auth.module.css'

type Phase = 'checking' | 'confirmed' | 'expired' | 'failed'

const NETWORK_MESSAGE = 'We could not reach the server. Check your connection and try again.'

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === 'rate_limited') return err.message
  if (err instanceof NetworkError) return NETWORK_MESSAGE
  return err instanceof Error ? err.message : 'Something went wrong. Try again.'
}

/** /verify-email?token=... (R-01): confirms the address, or offers a new link when the old one is used up. */
export function VerifyEmailPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [token] = useState(() => params.get('token') ?? '')
  const [phase, setPhase] = useState<Phase>(token ? 'checking' : 'expired')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  // verifyEmail CONSUMES the token. StrictMode runs effects twice in development; the second call would say "expired".
  const started = useRef(false)

  const verify = useMutation({ mutationFn: (t: string) => verifyEmail(t) })

  useEffect(() => {
    window.history.replaceState(window.history.state, '', window.location.pathname)
  }, [])

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    verify.mutate(token, {
      onSuccess: () => {
        setPhase('confirmed')
        // Refresh the cached user (if any) so email_verified is current.
        void queryClient.invalidateQueries({ queryKey: meKey })
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'verify_link_invalid') setPhase('expired')
        else {
          setError(errorMessage(err))
          setPhase('failed')
        }
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per mount; the ref guards the second effect run
  }, [])

  const resend = useMutation({
    mutationFn: () => resendVerification(),
    onSuccess: () => {
      setError(null)
      setSent(true)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        navigate('/login?next=/create')
        return
      }
      setSent(false)
      setError(errorMessage(err))
    },
  })

  if (phase === 'checking') {
    return (
      <AuthLayout credit={false}>
        <h1 className={styles.title}>Confirming your email</h1>
        <SkeletonGroup label="Confirming your email">
          <Skeleton height={44} />
        </SkeletonGroup>
      </AuthLayout>
    )
  }

  if (phase === 'confirmed') {
    const email = queryClient.getQueryData<User>(meKey)?.email
    return (
      <AuthLayout credit={false}>
        <span className={`${styles.badge} ${styles.success}`}><CheckIcon size={24} /></span>
        <h1 className={styles.title}>Your email is confirmed</h1>
        <p className={styles.lead}>
          Thanks, {email ? <strong>{email}</strong> : 'your email address'} is confirmed. You can now make talking
          videos.
        </p>
        <Link to="/create" className={styles.linkButton}>Start creating<ChevronRightIcon size={18} /></Link>
        <p className={`${styles.small} ${styles.center}`}>
          Not logged in on this device? <Link to="/login?next=/create" className={styles.link}>Log in</Link> first.
        </p>
      </AuthLayout>
    )
  }

  if (phase === 'failed') {
    return (
      <AuthLayout credit={false}>
        <h1 className={styles.title}>We could not confirm your email</h1>
        <Banner tone="danger" title={error ?? 'Something went wrong. Try again.'}>
          Your link has not been used up. Reload this page to try again.
        </Banner>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout credit={false}>
      <span className={`${styles.badge} ${styles.warning}`}><ClockIcon size={24} /></span>
      <h1 className={styles.title}>This link has expired</h1>
      <p className={styles.lead}>
        Confirmation links work once and only for 24 hours. This one has been used or is too old. If your email is
        already confirmed, there is nothing more to do.
      </p>
      {sent && <Banner tone="success" title="We sent a new link. Check your email." />}
      {error && <Banner tone="danger" title={error} />}
      <Button size="large" block busy={resend.isPending} busyLabel="Sending…" onClick={() => { setError(null); resend.mutate() }}>
        Send a new link
      </Button>
      <p className={styles.small}>We send it to the email on your account. You will be asked to log in first if you are not.</p>
      <Link to="/create" className={`${styles.link} ${styles.back}`}><ChevronLeftIcon size={16} />Go to Frameforge</Link>
    </AuthLayout>
  )
}
