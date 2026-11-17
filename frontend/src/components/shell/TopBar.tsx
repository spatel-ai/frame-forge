import type { ReactNode } from 'react'
import { Pill } from '../feedback'
import { Logo } from './Logo'
import styles from './TopBar.module.css'

export type TopBarProps = {
  /** Safety rule (frontend/CLAUDE.md): always visible while the mock provider is active. */
  mockMode: boolean
  /** Payments go through Razorpay (test keys outside production), so "no cost" would be untrue. */
  razorpayPayments?: boolean
  /** Slot for the end of the bar: the credits pill (M3) and the signed-in user menu (M2). Empty in M1.5. */
  children?: ReactNode
}

export function TopBar({ mockMode, razorpayPayments = false, children }: TopBarProps) {
  return (
    <header className={styles.bar}>
      <div className={styles.mark}><Logo wordmark={false} /></div>
      {mockMode && (
        <div className={styles.mock}>
          <Pill tone="warning" icon>
            {razorpayPayments
              ? 'Mock video — payments go through Razorpay'
              : 'Mock mode — no real generation, no cost'}
          </Pill>
        </div>
      )}
      <div className={styles.slot}>{children}</div>
    </header>
  )
}
