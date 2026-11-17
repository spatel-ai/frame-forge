import type { ReactNode } from 'react'
import { AlertIcon } from '../icons'
import styles from './ErrorState.module.css'

export interface ErrorStateProps {
  title?: string
  /** Plain-language message: what happened, what was not charged, what to do next. Never a raw error code. */
  message: string
  onRetry?: () => void
  /** Extra action, for example a link to support. */
  action?: ReactNode
  /** Small support reference id, shown as "Reference: abc". */
  referenceId?: string
  /** Heading level of the title: 2 when the state sits directly under the page's h1. Default 3. */
  headingLevel?: 2 | 3 | 4
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, action, referenceId, headingLevel = 3 }: ErrorStateProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <div className={styles.error} role="alert">
      <span className={styles.icon} aria-hidden="true"><AlertIcon size={32} /></span>
      <Heading className={styles.title}>{title}</Heading>
      <p className={styles.body}>{message}</p>
      {(onRetry || action) && (
        <div className={styles.actions}>
          {onRetry && <button type="button" className={styles.retry} onClick={onRetry}>Try again</button>}
          {action}
        </div>
      )}
      {referenceId && <p className={styles.ref}>Reference: {referenceId}</p>}
    </div>
  )
}
