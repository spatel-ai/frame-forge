import { forwardRef, type InputHTMLAttributes } from 'react'
import { FieldHint, FieldMessage, RequiredMark, useFieldA11y, type FieldProps } from './Field'
import fieldStyles from './Field.module.css'
import styles from './Checkbox.module.css'

export interface CheckboxProps extends FieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {}

/** Never pre-ticked by this component: pass `checked`/`defaultChecked` deliberately. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, error, success, id, required, className, 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const { ids, controlProps } = useFieldA11y(id, { hint, error, success }, describedBy)
  return (
    <div className={fieldStyles.field}>
      <div className={styles.row}>
        <input
          {...rest}
          {...controlProps}
          ref={ref}
          type="checkbox"
          required={required}
          className={className ? `${styles.input} ${className}` : styles.input}
        />
        <label htmlFor={ids.id} className={styles.label}>
          {label}
          {required ? <RequiredMark /> : null}
        </label>
      </div>
      {hint ? <FieldHint id={ids.hintId}>{hint}</FieldHint> : null}
      <FieldMessage ids={ids} error={error} success={success} />
    </div>
  )
})
