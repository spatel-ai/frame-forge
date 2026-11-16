import type { ReactNode } from 'react'
import styles from './Card.module.css'

export interface CardProps {
  title?: string
  /** Slot in the header, beside the title. */
  action?: ReactNode
  padding?: 'none' | 'md' | 'lg'
  children: ReactNode
}

export function Card({ title, action, padding = 'md', children }: CardProps) {
  return (
    <section className={`${styles.card} ${styles[padding]}`}>
      {(title || action) && (
        <header className={styles.header}>
          {title && <h3 className={styles.title}>{title}</h3>}
          {action && <div className={styles.action}>{action}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
