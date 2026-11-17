import type { ReactNode } from 'react'
import { AlertIcon } from '../../components/icons'
import styles from '../../components/feedback/ErrorState.module.css'

/**
 * The shared ErrorState's look, with an h2 title: on a job screen the message sits directly under
 * the page's h1, and ErrorState's fixed h3 would skip a heading level. Remove this once ErrorState
 * takes a heading level.
 */
export function ScreenError({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className={styles.error} role="alert">
      <span className={styles.icon} aria-hidden="true"><AlertIcon size={32} /></span>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.body}>{message}</p>
      {action && <div className={styles.actions}>{action}</div>}
    </div>
  )
}
