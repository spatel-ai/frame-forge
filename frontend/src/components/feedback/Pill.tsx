import type { ReactNode } from 'react'
import styles from './Pill.module.css'
import { toneIcons, type Tone } from './tone'

export interface PillProps {
  tone?: Tone
  /** Show the tone's icon before the text. */
  icon?: boolean
  children: ReactNode
}

export function Pill({ tone = 'neutral', icon = false, children }: PillProps) {
  const Icon = toneIcons[tone]
  return (
    <span className={`${styles.pill} ${styles[tone]}`}>
      {icon && <Icon size={14} />}
      {children}
    </span>
  )
}
