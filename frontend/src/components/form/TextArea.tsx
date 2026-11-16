import { forwardRef, useState, type ChangeEvent, type TextareaHTMLAttributes } from 'react'
import { Field, useFieldA11y, type FieldProps } from './Field'
import fieldStyles from './Field.module.css'
import shared from './shared.module.css'
import styles from './TextArea.module.css'

export interface TextAreaProps extends FieldProps, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'maxLength'> {
  /** Character limit shown as `used / max`. Typing is never blocked. */
  max?: number
}

type CounterState = 'ok' | 'near' | 'over'

/** Fraction of the limit at which the counter turns to the warning colour. */
const NEAR_LIMIT_RATIO = 0.9

function counterState(used: number, max: number): CounterState {
  if (used > max) return 'over'
  if (used >= max * NEAR_LIMIT_RATIO) return 'near'
  return 'ok'
}

function announcement(state: CounterState, used: number, max: number): string {
  if (state === 'over') return `${used - max} characters over the limit of ${max}`
  if (state === 'near') return `${max - used} characters left`
  return ''
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  {
    label,
    hint,
    error,
    success,
    id,
    required,
    max,
    className,
    onChange,
    value,
    defaultValue,
    'aria-describedby': describedBy,
    ...rest
  },
  ref,
) {
  const { ids, controlProps } = useFieldA11y(id, { hint, error, success }, describedBy)
  const [inner, setInner] = useState(() => String(defaultValue ?? ''))
  const used = String(value ?? inner).length

  // The live region text only changes when the counter crosses a threshold,
  // so screen readers are not told about every keystroke.
  const state: CounterState = max === undefined ? 'ok' : counterState(used, max)
  const [announced, setAnnounced] = useState<{ state: CounterState; text: string }>({ state: 'ok', text: '' })
  if (max !== undefined && announced.state !== state) {
    setAnnounced({ state, text: announcement(state, used, max) })
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setInner(event.target.value)
    onChange?.(event)
  }

  const counterClass = [styles.counter, state === 'near' ? styles.near : '', state === 'over' ? styles.over : '']
    .filter(Boolean)
    .join(' ')

  return (
    <Field ids={ids} label={label} required={required} hint={hint} error={error} success={success}>
      <textarea
        {...rest}
        {...controlProps}
        ref={ref}
        required={required}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        data-valid={success && !error ? 'true' : undefined}
        className={[fieldStyles.control, styles.area, className].filter(Boolean).join(' ')}
      />
      {max !== undefined ? (
        <div className={styles.footer}>
          <span data-testid="char-counter" data-state={state} aria-hidden="true" className={counterClass}>
            {used} / {max}
          </span>
          <span className={shared.srOnly} aria-live="polite">
            {announced.text}
          </span>
        </div>
      ) : null}
    </Field>
  )
})
