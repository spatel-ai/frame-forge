import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from 'react'
import styles from './Button.module.css'
import shared from './shared.module.css'
import { Spinner } from './Spinner'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
  size?: 'default' | 'large'
  /** Stretch to the width of the container. */
  block?: boolean
  /** Request in flight: shows a spinner and ignores clicks, but keeps focus. */
  busy?: boolean
  /** Replaces the visible label while busy, e.g. "Saving…". */
  busyLabel?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'default',
    block = false,
    busy = false,
    busyLabel,
    type = 'button',
    className,
    onClick,
    children,
    ...rest
  },
  ref,
) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      // Not `disabled`: that would drop keyboard focus. Block the click instead.
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  const classes = [
    styles.button,
    styles[variant],
    size === 'large' ? styles.large : '',
    block ? styles.block : '',
    busy ? styles.busy : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button {...rest} ref={ref} type={type} className={classes} aria-busy={busy || undefined} onClick={handleClick}>
      {busy ? <Spinner size="small" decorative inherit={variant !== 'secondary' && variant !== 'quiet'} /> : null}
      {busy && busyLabel ? busyLabel : children}
      {busy && !busyLabel ? <span className={shared.srOnly}>Working…</span> : null}
    </button>
  )
})
