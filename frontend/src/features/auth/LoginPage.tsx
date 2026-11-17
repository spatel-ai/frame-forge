import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ApiError, login, meKey, NetworkError } from '../../api/client'
import { Banner } from '../../components/feedback'
import { Button, PasswordField, TextField } from '../../components/form'
import { AuthLayout } from './AuthLayout'
import styles from './auth.module.css'
import { safeNext, useFields, validateCurrentPassword, validateEmail } from '../../lib/validation'

const ORDER = ['email', 'password'] as const

/** Log in (R-01). */
export function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [banner, setBanner] = useState<string | null>(null)

  const f = useFields({ email: '', password: '' }, {
    email: (v) => validateEmail(v.email),
    password: (v) => validateCurrentPassword(v.password),
  }, [...ORDER])

  const mutation = useMutation({
    mutationFn: (v: { email: string; password: string }) => login(v.email, v.password),
    onSuccess: (user) => {
      queryClient.setQueryData(meKey, user)
      navigate(next, { replace: true })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'invalid_credentials') {
        setBanner('Email or password is wrong.')
        f.focus('password')
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
    if (!f.checkAll()) {
      setBanner(null)
      return
    }
    mutation.mutate({ email: f.values.email.trim(), password: f.values.password })
  }

  return (
    <AuthLayout>
      <h1 className={styles.title}>Log in</h1>
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
        <PasswordField
          ref={f.ref('password')}
          label="Password"
          autoComplete="current-password"
          value={f.values.password}
          error={f.error('password')}
          onChange={(e) => f.set('password', e.target.value)}
          onBlur={() => f.blur('password')}
        />
        <Link to="/forgot-password" className={`${styles.link} ${styles.forgot}`}>Forgot password?</Link>
        {banner && <Banner tone="danger" title={banner} />}
        <Button type="submit" size="large" block busy={mutation.isPending} busyLabel="Logging in…">
          Log in
        </Button>
      </form>
      <p className={styles.center}>
        New here? <Link to="/signup" className={styles.link}>Create an account</Link>
      </p>
    </AuthLayout>
  )
}
