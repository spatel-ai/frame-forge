import { CheckIcon } from '../icons'
import styles from './Stepper.module.css'

export interface StepperStep {
  label: string
  /** Makes the step a link. Steps are plain text otherwise. */
  href?: string
}

export interface StepperProps {
  steps: StepperStep[]
  /** Current step, counting from 1. */
  current: number
  /** Accessible name of the list, for example "Create a video". */
  label?: string
}

export function Stepper({ steps, current, label = 'Progress' }: StepperProps) {
  const currentStep = steps[current - 1]
  return (
    <div className={styles.wrap}>
      <ol className={styles.list} aria-label={label}>
        {steps.map((step, index) => {
          const number = index + 1
          const state = number < current ? 'done' : number === current ? 'current' : 'upcoming'
          const text = (
            <>
              <span className={styles.marker} aria-hidden="true">
                {state === 'done' ? <CheckIcon size={14} /> : number}
              </span>
              <span className={styles.label}>{step.label}</span>
            </>
          )
          return (
            <li key={step.label} className={`${styles.step} ${styles[state]}`} aria-current={state === 'current' ? 'step' : undefined}>
              {step.href ? <a className={styles.link} href={step.href}>{text}</a> : <span className={styles.item}>{text}</span>}
            </li>
          )
        })}
      </ol>
      {currentStep && (
        <p className={styles.compact} data-testid="stepper-compact">
          Step {current} of {steps.length}: {currentStep.label}
        </p>
      )}
    </div>
  )
}
