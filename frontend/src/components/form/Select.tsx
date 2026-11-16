import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronRightIcon } from '../icons'
import { Field, useFieldA11y, type FieldProps } from './Field'
import fieldStyles from './Field.module.css'
import styles from './Select.module.css'

export interface SelectProps extends FieldProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {}

/** Native select. Pass `<option>` children. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, success, id, required, className, children, 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const { ids, controlProps } = useFieldA11y(id, { hint, error, success }, describedBy)
  return (
    <Field ids={ids} label={label} required={required} hint={hint} error={error} success={success}>
      <div className={styles.wrap}>
        <select
          {...rest}
          {...controlProps}
          ref={ref}
          required={required}
          data-valid={success && !error ? 'true' : undefined}
          className={[fieldStyles.control, styles.select, className].filter(Boolean).join(' ')}
        >
          {children}
        </select>
        <ChevronRightIcon className={styles.chevron} size={16} />
      </div>
    </Field>
  )
})
