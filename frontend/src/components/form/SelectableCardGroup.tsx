import { useId, type ReactNode } from 'react'
import { FieldHint, FieldMessage, RequiredMark, useFieldA11y } from './Field'
import fieldStyles from './Field.module.css'
import styles from './SelectableCardGroup.module.css'
import { SelectableCardGroupContext } from './SelectableCardContext'

export interface SelectableCardGroupProps {
  /** Group name: the legend, e.g. "Start banner". */
  legend: ReactNode
  hint?: ReactNode
  error?: string
  /** Radio `name` shared by the cards inside. Generated when omitted. */
  name?: string
  required?: boolean
  children: ReactNode
}

export function SelectableCardGroup({ legend, hint, error, name, required, children }: SelectableCardGroupProps) {
  const generated = useId()
  const groupName = name ?? generated
  const { ids } = useFieldA11y(groupName, { hint, error })
  const describedBy = [ids.hintId, ids.messageId].filter(Boolean).join(' ') || undefined
  return (
    <fieldset
      className={fieldStyles.field}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
    >
      <legend className={fieldStyles.label}>
        {legend}
        {required ? <RequiredMark /> : null}
      </legend>
      {hint ? <FieldHint id={ids.hintId}>{hint}</FieldHint> : null}
      <SelectableCardGroupContext.Provider value={{ name: groupName }}>
        <div className={styles.cards}>{children}</div>
      </SelectableCardGroupContext.Provider>
      <FieldMessage ids={ids} error={error} />
    </fieldset>
  )
}
