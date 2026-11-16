import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { Field, useFieldA11y, type FieldProps } from './Field'
import styles from './PasswordField.module.css'

export interface PasswordFieldProps extends FieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {}

/** Password input with a Show/Hide toggle (Login and Signup designs). The toggle is a native button. */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { label, hint, error, success, id, required, className, 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false)
  const { ids, controlProps } = useFieldA11y(id, { hint, error, success }, describedBy)
  return (
    <Field ids={ids} label={label} required={required} hint={hint} error={error} success={success}>
      <div
        className={styles.wrap}
        data-invalid={error ? 'true' : undefined}
        data-valid={success && !error ? 'true' : undefined}
      >
        <input
          {...rest}
          {...controlProps}
          ref={ref}
          type={visible ? 'text' : 'password'}
          required={required}
          className={className ? `${styles.input} ${className}` : styles.input}
        />
        <button
          type="button"
          className={styles.toggle}
          aria-controls={ids.id}
          aria-label={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </Field>
  )
})
