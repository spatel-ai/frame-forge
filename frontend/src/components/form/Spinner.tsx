import styles from './Spinner.module.css'

export interface SpinnerProps {
  /** Accessible name announced for the status. */
  label?: string
  size?: 'small' | 'medium' | 'large'
  /** Hide from assistive tech (use when a parent already announces the busy state). */
  decorative?: boolean
  /** Draw in the current text colour, for use on a coloured button. */
  inherit?: boolean
}

export function Spinner({ label = 'Loading', size = 'medium', decorative = false, inherit = false }: SpinnerProps) {
  const className = [styles.spinner, styles[size], inherit ? styles.inherit : ''].filter(Boolean).join(' ')
  if (decorative) return <span className={className} aria-hidden="true" />
  return <span className={className} role="status" aria-label={label} />
}
