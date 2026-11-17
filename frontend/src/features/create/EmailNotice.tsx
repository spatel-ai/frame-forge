import { useMutation } from '@tanstack/react-query'
import { ApiError, resendVerification } from '../../api/client'
import type { User } from '../../api/client'
import { Banner } from '../../components/feedback'
import { Button } from '../../components/form'
import { errMsg } from '../../lib/util'
import styles from './EmailNotice.module.css'

/** Shown above the stepper while the account's email is not confirmed (D-036). */
export function EmailNotice({ user }: { user: User }) {
  const resend = useMutation({ mutationFn: resendVerification })
  const rateLimited = resend.error instanceof ApiError && resend.error.code === 'rate_limited'
  const failure = resend.error ? (rateLimited ? resend.error.message : errMsg(resend.error)) : null

  return (
    <Banner
      tone="warning"
      title="Confirm your email to make videos"
      action={
        <Button variant="secondary" busy={resend.isPending} busyLabel="Sending…" onClick={() => resend.mutate()}>
          Send the link again
        </Button>
      }
    >
      <p className={styles.line}>
        We sent a link to <strong>{user.email}</strong>. Open it on any device; it works once, for 24 hours.
      </p>
      {resend.isSuccess && <p className={styles.line}>The link was sent again. Check your inbox.</p>}
      {failure && <p className={styles.line} role="alert">{failure}</p>}
    </Banner>
  )
}
