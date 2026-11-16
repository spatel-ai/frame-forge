import type { ReactNode } from 'react'
import { Stepper } from '../../components/layout'
import { STEPS } from './steps'
import styles from './CreateLayout.module.css'

/** Heading and stepper shared by every create screen. Omit `step` while the step is not yet known. */
export function CreateLayout({ step, children }: { step?: number; children: ReactNode }) {
  return (
    <div className={styles.layout}>
      <h1 className={styles.title}>Create a video</h1>
      {step !== undefined && <Stepper steps={STEPS} current={step} label="Create a video" />}
      {children}
    </div>
  )
}
