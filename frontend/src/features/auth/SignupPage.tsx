import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError, meKey, NetworkError, signup } from '../../api/client'
import { Banner } from '../../components/feedback'
import { Button, PasswordField, TextField } from '../../components/form'
import { AuthLayout } from './AuthLayout'
import styles from './auth.module.css'
import { useFields, validateEmail, validateName, validateNewPassword } from '../../lib/validation'

const ORDER = ['name', 'email', 'password'] as const

/** Sign up (R-01). The Terms checkbox in the design is left out: the documents do not exist yet (owner). */
export function SignupPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [banner, setBanner] = useState<string | null>(null)
  const [emailTaken, setEmailTaken] = useState(false)

  const f = useFields({ name: '', email: '', password: '' }, {
    name: (v) => validateName(v.name),
    email: (v) => validateEmail(v.email),
    password: (v) => validateNewPassword(v.password),
  }, [...ORDER])

  const mutation = useMutation({
    mutationFn: (v: { name: string; email: string; password: string }) => signup(v.name, v.email, v.password),
    onSuccess: (user) => {
      queryClient.setQueryData(meKey, user)
      navigate('/create', { replace: true })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'email_taken') {
        setEmailTaken(true)
        f.setServerError('email', err.message)
      } else if (err instanceof ApiError && err.code === 'rate_limited') {
        setBanner(err.message)
      } else if (err instanceof ApiError && f.showServerErrors(err.fields)) {
        setBanner(null)
      } else if (err instanceof NetworkError) {
        setBanner('We could not reach the server. Check your connection and try again.')
      } else {
        setBanner(err instanceof Error ? err.message : 'Something went wrong. Try again.')
      }
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (mutation.isPending) return
    setBanner(null)
    setEmailTaken(false)
    if (!f.checkAll()) return
    mutation.mutate({ name: f.values.name.trim(), email: f.values.email.trim(), password: f.values.password })
  }

  return (
    <AuthLayout>
      <h1 className={styles.title}>Create your account</h1>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <TextField
          ref={f.ref('name')}
          label="Name"
          autoComplete="name"
          value={f.values.name}
          error={f.error('name')}
          success={f.valid('name') ? 'Looks good' : undefined}
          onChange={(e) => f.set('name', e.target.value)}
          onBlur={() => f.blur('name')}
        />
        <div className={styles.stack}>
          <TextField
            ref={f.ref('email')}
            label="Email"
            type="email"
            autoComplete="email"
            value={f.values.email}
            error={f.error('email')}
            onChange={(e) => {
              setEmailTaken(false)
              f.set('email', e.target.value)
            }}
            onBlur={() => f.blur('email')}
          />
          {emailTaken && (
            <p className={styles.emailTaken}>
              <Link to="/login" className={styles.link}>Log in</Link> instead, or{' '}
              <Link to="/forgot-password" className={styles.link}>reset your password</Link>.
            </p>
          )}
        </div>
        <PasswordField
          ref={f.ref('password')}
          label="Password"
          hint="At least 10 characters"
          autoComplete="new-password"
          value={f.values.password}
          error={f.error('password')}
          onChange={(e) => f.set('password', e.target.value)}
          onBlur={() => f.blur('password')}
        />
        <p className={styles.small}>We will email you a link to confirm your address.</p>
        {banner && <Banner tone="danger" title={banner} />}
        <Button type="submit" size="large" block busy={mutation.isPending} busyLabel="Creating account…">
          Create account
        </Button>
      </form>
      <p className={styles.center}>
        Already have an account? <Link to="/login" className={styles.link}>Log in</Link>
      </p>
    </AuthLayout>
  )
}
