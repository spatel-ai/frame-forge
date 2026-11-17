import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, changePassword, logout, logoutAll, meKey, NetworkError, resendVerification } from '../../api/client'
import type { User } from '../../api/client'
import { Banner, Dialog, Pill, Skeleton, SkeletonGroup } from '../../components/feedback'
import { Button, PasswordField } from '../../components/form'
import { Card } from '../../components/layout'
import { useMe } from '../../lib/session'
import { errMsg } from '../../lib/util'
import { useFields, validateConfirm, validateCurrentPassword, validateNewPassword } from '../../lib/validation'
import { storeId } from '../../lib/jobStorage'
import styles from './AccountPage.module.css'

const NETWORK_MESSAGE = 'We could not reach the server. Check your connection and try again.'
const failureMessage = (e: unknown) => (e instanceof NetworkError ? NETWORK_MESSAGE : errMsg(e))

function Profile({ user }: { user: User }) {
  const resend = useMutation({ mutationFn: resendVerification })
  const failure = resend.error ? failureMessage(resend.error) : null
  return (
    <Card>
      <h2 className={styles.heading}>Profile</h2>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Name</dt>
          <dd>{user.name}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Email</dt>
          <dd>
            <span>{user.email}</span>
            {user.email_verified ? (
              <Pill tone="success" icon>Verified</Pill>
            ) : (
              <>
                <Pill tone="warning" icon>Not confirmed</Pill>
                <Button variant="secondary" busy={resend.isPending} busyLabel="Sending…" onClick={() => resend.mutate()}>
                  Send the link again
                </Button>
              </>
            )}
          </dd>
        </div>
      </dl>
      {!user.email_verified && resend.isSuccess && <p className={`${styles.note} ${styles.gap}`} role="status">The link was sent again. Check your inbox.</p>}
      {!user.email_verified && failure && <p className={`${styles.note} ${styles.gap}`} role="alert">{failure}</p>}
    </Card>
  )
}

/** Remounted (via key) after a successful save, which is how the typed passwords are cleared. */
function PasswordForm({ onSaved, onStart }: { onSaved: () => void; onStart: () => void }) {
  const queryClient = useQueryClient()
  const [banner, setBanner] = useState<string | null>(null)
  const f = useFields({ current: '', next: '', confirm: '' }, {
    current: (v) => validateCurrentPassword(v.current),
    next: (v) => validateNewPassword(v.next),
    confirm: (v) => validateConfirm(v.next, v.confirm),
  }, ['current', 'next', 'confirm'])

  const save = useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) => changePassword(current, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: meKey })
      onSaved()
    },
    onError: (err) => {
      const fields = err instanceof ApiError ? err.fields : {}
      if (f.showServerErrors({ current: fields.current_password, next: fields.new_password })) setBanner(null)
      else setBanner(failureMessage(err))
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (save.isPending) return
    setBanner(null)
    if (!f.checkAll()) return
    onStart()
    save.mutate({ current: f.values.current, next: f.values.next })
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={styles.narrow}>
        <PasswordField
          ref={f.ref('current')}
          label="Current password"
          autoComplete="current-password"
          value={f.values.current}
          error={f.error('current')}
          onChange={(e) => f.set('current', e.target.value)}
          onBlur={() => f.blur('current')}
        />
      </div>
      <div className={styles.narrow}>
        <PasswordField
          ref={f.ref('next')}
          label="New password"
          hint="At least 10 characters."
          autoComplete="new-password"
          value={f.values.next}
          error={f.error('next')}
          onChange={(e) => f.set('next', e.target.value)}
          onBlur={() => f.blur('next')}
        />
      </div>
      <div className={styles.narrow}>
        <PasswordField
          ref={f.ref('confirm')}
          label="Confirm new password"
          autoComplete="new-password"
          value={f.values.confirm}
          error={f.error('confirm')}
          onChange={(e) => f.set('confirm', e.target.value)}
          onBlur={() => f.blur('confirm')}
        />
      </div>
      {banner && <Banner tone="danger" title={banner} />}
      <Button type="submit" size="large" busy={save.isPending} busyLabel="Saving…">Save new password</Button>
    </form>
  )
}

function ChangePassword() {
  const [saved, setSaved] = useState(false)
  const [formKey, setFormKey] = useState(0)
  return (
    <Card>
      <h2 className={styles.heading}>Change password</h2>
      {saved && (
        <div className={styles.gap}>
          <Banner tone="success" title="Password changed. Your other devices were logged out." onDismiss={() => setSaved(false)} />
        </div>
      )}
      <PasswordForm
        key={formKey}
        onStart={() => setSaved(false)}
        onSaved={() => {
          setSaved(true)
          setFormKey((k) => k + 1)
        }}
      />
    </Card>
  )
}

function Sessions({ user }: { user: User }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Same clearing as a 401 (lib/session.ts): forget server data and the stored job id, then log in again.
  const leave = () => {
    queryClient.clear()
    storeId(null)
    void navigate('/login', { replace: true })
  }
  const onError = (err: unknown) => {
    setConfirming(false)
    setError(failureMessage(err))
  }
  const everywhere = useMutation({ mutationFn: logoutAll, onSuccess: leave, onError })
  const single = useMutation({ mutationFn: logout, onSuccess: leave, onError })
  const n = user.active_sessions

  return (
    <>
      <Card>
        <h2 className={styles.heading}>Sessions</h2>
        <p className={styles.line}>You are logged in on {n} {n === 1 ? 'device' : 'devices'}.</p>
        <div className={styles.row}>
          <Button
            variant="danger"
            aria-describedby="logout-all-hint"
            onClick={() => {
              setError(null)
              setConfirming(true)
            }}
          >
            Log out everywhere
          </Button>
          <span id="logout-all-hint" className={styles.note}>You will need to log in again on every device, including this one.</span>
        </div>
      </Card>
      {error && <Banner tone="danger" title={error} onDismiss={() => setError(null)} />}
      <div>
        <Button
          variant="secondary"
          busy={single.isPending}
          busyLabel="Logging out…"
          onClick={() => {
            setError(null)
            single.mutate()
          }}
        >
          Log out
        </Button>
      </div>
      <Dialog open={confirming} onClose={() => !everywhere.isPending && setConfirming(false)} title="Log out everywhere?">
        <p className={styles.line}>You will need to log in again on every device, including this one.</p>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={everywhere.isPending}>Cancel</Button>
          <Button variant="danger" busy={everywhere.isPending} busyLabel="Logging out…" onClick={() => everywhere.mutate()}>
            Log out everywhere
          </Button>
        </div>
      </Dialog>
    </>
  )
}

export default function AccountPage() {
  const { data: me } = useMe()
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Account</h1>
      {me ? (
        <>
          <Profile user={me} />
          <ChangePassword />
          <Sessions user={me} />
        </>
      ) : (
        <SkeletonGroup label="Loading your account">
          <Skeleton height={120} />
          <Skeleton height={240} />
        </SkeletonGroup>
      )}
    </div>
  )
}
