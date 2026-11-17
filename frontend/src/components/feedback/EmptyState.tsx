import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  children?: ReactNode
  /** Slot for the first action, usually a Button. */
  action?: ReactNode
  /** Heading level of the title: 2 when the state sits directly under the page's h1. Default 3. */
  headingLevel?: 2 | 3 | 4
}

export function EmptyState({ icon, title, children, action, headingLevel = 3 }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <div className={styles.empty}>
      {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
      <Heading className={styles.title}>{title}</Heading>
      {children && <p className={styles.body}>{children}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
