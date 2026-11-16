import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { CheckIcon } from '../icons'
import styles from './SelectableCard.module.css'
import { useSelectableCardGroup } from './SelectableCardContext'

export interface SelectableCardProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Card title; also the radio's accessible name. */
  label: ReactNode
  description?: ReactNode
  /** Preview area shown above the title (image, video poster). */
  media?: ReactNode
}

/** A radio button presented as a card. Selection and arrow keys come from the native radio. */
export const SelectableCard = forwardRef<HTMLInputElement, SelectableCardProps>(function SelectableCard(
  { label, description, media, name, className, ...rest },
  ref,
) {
  const group = useSelectableCardGroup()
  return (
    <label className={className ? `${styles.card} ${className}` : styles.card}>
      <input {...rest} ref={ref} type="radio" name={name ?? group.name} className={styles.input} />
      {media ? <span className={styles.media}>{media}</span> : null}
      <span className={styles.title}>{label}</span>
      {description ? <span className={styles.description}>{description}</span> : null}
      <span className={styles.selected} aria-hidden="true">
        <CheckIcon size={16} />
        Selected
      </span>
    </label>
  )
})
