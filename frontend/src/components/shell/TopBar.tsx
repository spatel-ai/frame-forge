import type { ReactNode } from 'react'
import { Pill } from '../feedback'
import { Logo } from './Logo'
import styles from './TopBar.module.css'

export type TopBarProps = {
  /** Safety rule (frontend/CLAUDE.md): always visible while the mock provider is active. */
  mockMode: boolean
  /** Slot for the end of the bar: the credits pill (M3) and the signed-in user menu (M2). Empty in M1.5. */
  children?: ReactNode
}

export function TopBar({ mockMode, children }: TopBarProps) {
  return (
    <header className={styles.bar}>
      <div className={styles.mark}><Logo wordmark={false} /></div>
      {mockMode && (
        <div className={styles.mock}>
          <Pill tone="warning" icon>Mock mode — no real generation, no cost</Pill>
        </div>
      )}
      <div className={styles.slot}>{children}</div>
    </header>
  )
}
