import type { ReactNode } from 'react'
import { CloseIcon } from '../icons'
import styles from './Banner.module.css'
import { toneIcons, type Tone } from './tone'

export interface BannerProps {
  tone?: Tone
  title: string
  children?: ReactNode
  /** Slot for a Button the screen passes in. */
  action?: ReactNode
  onDismiss?: () => void
}

export function Banner({ tone = 'info', title, children, action, onDismiss }: BannerProps) {
  const Icon = toneIcons[tone]
  return (
    <div className={`${styles.banner} ${styles[tone]}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className={styles.icon}><Icon size={20} /></span>
      <div className={styles.content}>
        <p className={styles.title}>{title}</p>
        {children && <div className={styles.body}>{children}</div>}
        {action && <div className={styles.action}>{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={onDismiss}>
          <CloseIcon size={18} />
        </button>
      )}
    </div>
  )
}
