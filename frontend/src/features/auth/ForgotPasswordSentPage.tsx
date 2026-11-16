import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { ApiError, forgotPassword, NetworkError } from '../../api/client'
import { Banner } from '../../components/feedback'
import { Button } from '../../components/form'
import { MailIcon } from '../../components/icons'
import { AuthLayout } from './AuthLayout'
import styles from './auth.module.css'

export const RESEND_SECONDS = 60

function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** "Check your email" (R-01): shows the email that was entered; Resend is locked for 60 seconds after each send. */
export function ForgotPasswordSentPage() {
  const location = useLocation()
  const email = (location.state as { email?: unknown } | null)?.email
  const [left, setLeft] = useState(RESEND_SECONDS)
  const [resent, setResent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (left <= 0) return
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [left])

  const resend = useMutation({
    mutationFn: (to: string) => forgotPassword(to),
    onSuccess: () => {
      setResent(true)
      setLeft(RESEND_SECONDS)
    },
    onError: (err) => {
      setResent(false)
      setError(
        err instanceof ApiError && err.code === 'rate_limited'
          ? err.message
          : err instanceof NetworkError
            ? 'We could not reach the server. Check your connection and try again.'
            : err instanceof Error
              ? err.message
              : 'Something went wrong. Try again.',
      )
    },
  })

  // Opened directly (no email known): go back to the form.
  if (typeof email !== 'string' || !email) return <Navigate to="/forgot-password" replace />

  const locked = left > 0
  return (
    <AuthLayout>
      <span className={`${styles.badge} ${styles.success}`}><MailIcon size={24} /></span>
      <h1 className={styles.title}>Check your email</h1>
      <p className={styles.lead}>
        If an account exists for <strong>{email}</strong>, we have sent it a link to reset your password. The link
        works once and expires in 30 minutes.
      </p>
      <div className={styles.helpBox} role="status">
        <strong>No email?</strong>
        <span>Check your spam folder, or make sure you used the email you signed up with.</span>
        {resent && <span>We sent another link.</span>}
      </div>
      {error && <Banner tone="danger" title={error} />}
      <Button
        variant="secondary"
        disabled={locked}
        busy={resend.isPending}
        busyLabel="Sending…"
        onClick={() => {
          setError(null)
          resend.mutate(email)
        }}
      >
        {locked ? `Resend link in ${formatClock(left)}` : 'Resend link'}
      </Button>
      <Link to="/login" className={styles.linkButton}>Back to log in</Link>
    </AuthLayout>
  )
}
