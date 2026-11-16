import { useId, type ReactNode } from 'react'
import { AlertIcon, CheckIcon } from '../icons'
import styles from './Field.module.css'

/** Props shared by every field component (UX.md section 7, "Inputs and validation"). */
export interface FieldProps {
  /** Visible label. Required: placeholder text is never the label. */
  label: ReactNode
  /** Constraint stated before the customer hits it. */
  hint?: ReactNode
  /** Error message; also used for server `fields` errors. */
  error?: string
  /** Positive message such as "Looks good". */
  success?: string
}

export interface FieldIds {
  id: string
  hintId: string | undefined
  messageId: string | undefined
}

/** Ids and the aria wiring that every field shares. */
export function useFieldA11y(
  idProp: string | undefined,
  { hint, error, success }: Pick<FieldProps, 'hint' | 'error' | 'success'>,
  extraDescribedBy?: string,
) {
  const generated = useId()
  const id = idProp ?? generated
  const hintId = hint ? `${id}-hint` : undefined
  const messageId = error ? `${id}-error` : success ? `${id}-success` : undefined
  const describedBy = [hintId, messageId, extraDescribedBy].filter(Boolean).join(' ') || undefined
  const ids: FieldIds = { id, hintId, messageId }
  return {
    ids,
    controlProps: {
      id,
      'aria-describedby': describedBy,
      'aria-invalid': error ? (true as const) : undefined,
    },
  }
}

export function RequiredMark() {
  return (
    <span className={styles.required} aria-hidden="true">
      *
    </span>
  )
}

export function FieldHint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className={styles.hint}>
      {children}
    </p>
  )
}

/** Error (alert icon, announced) or success (check icon) text under a field. */
export function FieldMessage({ ids, error, success }: { ids: FieldIds; error?: string; success?: string }) {
  if (error) {
    return (
      <p id={ids.messageId} className={`${styles.message} ${styles.error}`} role="alert">
        <AlertIcon size={16} />
        <span>{error}</span>
      </p>
    )
  }
  if (success) {
    return (
      <p id={ids.messageId} className={`${styles.message} ${styles.success}`}>
        <CheckIcon size={16} />
        <span>{success}</span>
      </p>
    )
  }
  return null
}

/** Label + hint + control + message, for text-like fields. */
export function Field({
  ids,
  label,
  required,
  hint,
  error,
  success,
  children,
}: FieldProps & { ids: FieldIds; required?: boolean; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label htmlFor={ids.id} className={styles.label}>
        {label}
        {required ? <RequiredMark /> : null}
      </label>
      {hint ? <FieldHint id={ids.hintId}>{hint}</FieldHint> : null}
      {children}
      <FieldMessage ids={ids} error={error} success={success} />
    </div>
  )
}
