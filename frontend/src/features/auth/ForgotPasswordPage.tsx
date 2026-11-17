import { useMutation } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError, forgotPassword, NetworkError } from '../../api/client'
import { Banner } from '../../components/feedback'
import { Button, TextField } from '../../components/form'
import { ChevronLeftIcon, KeyIcon } from '../../components/icons'
import { AuthLayout } from './AuthLayout'
import styles from './auth.module.css'
import { useFields, validateEmail } from '../../lib/validation'

/** Ask for a reset link (R-01). The answer is the same for unknown emails, so the next screen never confirms an account. */
export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [banner, setBanner] = useState<string | null>(null)
  const f = useFields({ email: '' }, { email: (v) => validateEmail(v.email) }, ['email'])

  const mutation = useMutation({
    mutationFn: (email: string) => forgotPassword(email),
    onSuccess: (_data, email) => navigate('/forgot-password/sent', { state: { email } }),
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'rate_limited') setBanner(err.message)
      else if (err instanceof ApiError && f.showServerErrors(err.fields)) setBanner(null)
      else if (err instanceof NetworkError) setBanner('We could not reach the server. Check your connection and try again.')
      else setBanner(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (mutation.isPending) return
    setBanner(null)
    if (!f.checkAll()) return
    mutation.mutate(f.values.email.trim())
  }

  return (
    <AuthLayout>
      <span className={`${styles.badge} ${styles.primary}`}><KeyIcon size={24} /></span>
      <h1 className={styles.title}>Reset your password</h1>
      <p className={styles.lead}>Enter the email you signed up with. We will send you a link to set a new password.</p>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <TextField
          ref={f.ref('email')}
          label="Email"
          type="email"
          autoComplete="email"
          value={f.values.email}
          error={f.error('email')}
          onChange={(e) => f.set('email', e.target.value)}
          onBlur={() => f.blur('email')}
        />
        {banner && <Banner tone="danger" title={banner} />}
        <Button type="submit" size="large" block busy={mutation.isPending} busyLabel="Sending…">
          Send reset link
        </Button>
      </form>
      <Link to="/login" className={`${styles.link} ${styles.back}`}><ChevronLeftIcon size={16} />Back to log in</Link>
    </AuthLayout>
  )
}
