import { forwardRef, type InputHTMLAttributes } from 'react'
import { Field, useFieldA11y, type FieldProps } from './Field'
import styles from './Field.module.css'

export interface TextFieldProps extends FieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, success, id, required, className, type = 'text', 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const { ids, controlProps } = useFieldA11y(id, { hint, error, success }, describedBy)
  return (
    <Field ids={ids} label={label} required={required} hint={hint} error={error} success={success}>
      <input
        {...rest}
        {...controlProps}
        ref={ref}
        type={type}
        required={required}
        data-valid={success && !error ? 'true' : undefined}
        className={className ? `${styles.control} ${className}` : styles.control}
      />
    </Field>
  )
})
