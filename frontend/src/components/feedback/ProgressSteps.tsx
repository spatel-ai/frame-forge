import { AlertIcon, CheckIcon } from '../icons'
import styles from './ProgressSteps.module.css'

export type ProgressStepState = 'done' | 'current' | 'upcoming' | 'failed'

export interface ProgressStep {
  label: string
  state: ProgressStepState
  /** Optional detail under the label, for example "About 2 minutes". */
  hint?: string
}

const stateWord: Record<ProgressStepState, string> = {
  done: 'Done',
  current: 'In progress',
  upcoming: 'Waiting',
  failed: 'Failed',
}

export function ProgressSteps({ steps }: { steps: ProgressStep[] }) {
  return (
    <div role="status" aria-live="polite">
      <ol className={styles.list}>
        {steps.map((step) => (
          <li
            key={step.label}
            className={`${styles.step} ${styles[step.state]}`}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span className={styles.marker} aria-hidden="true">
              {step.state === 'done' && <CheckIcon size={16} />}
              {step.state === 'failed' && <AlertIcon size={16} />}
              {step.state === 'current' && <span className={styles.dot} />}
            </span>
            <span className={styles.text}>
              <span className={styles.label}>{step.label}</span>
              <span className={styles.word}>{stateWord[step.state]}</span>
              {step.hint && <span className={styles.hint}>{step.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
