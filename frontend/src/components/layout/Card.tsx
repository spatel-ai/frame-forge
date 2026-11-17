import type { ReactNode } from 'react'
import styles from './Card.module.css'

export interface CardProps {
  title?: string
  /** Slot in the header, beside the title. */
  action?: ReactNode
  padding?: 'none' | 'md' | 'lg'
  children: ReactNode
  /** Heading level of the title: 2 when the card sits directly under the page's h1. Default 3. */
  headingLevel?: 2 | 3 | 4
}

export function Card({ title, action, padding = 'md', children, headingLevel = 3 }: CardProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <section className={`${styles.card} ${styles[padding]}`}>
      {(title || action) && (
        <header className={styles.header}>
          {title && <Heading className={styles.title}>{title}</Heading>}
          {action && <div className={styles.action}>{action}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
