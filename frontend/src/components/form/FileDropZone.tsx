import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type InputHTMLAttributes,
} from 'react'
import { UploadIcon } from '../icons'
import { Button } from './Button'
import { FieldHint, FieldMessage, RequiredMark, useFieldA11y, type FieldProps } from './Field'
import fieldStyles from './Field.module.css'
import styles from './FileDropZone.module.css'

export interface FileDropZoneProps
  extends FieldProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'onChange' | 'value' | 'defaultValue'> {
  /** Same syntax as the native attribute: MIME types, `image/*` or extensions. */
  accept?: string
  /** Largest allowed file in bytes. */
  maxBytes?: number
  /** Plain-language name of what is allowed, used in the wrong-type message: "a JPEG, PNG or WebP image". */
  acceptLabel?: string
  /** Called with the accepted file, or null when removed or rejected. */
  onChange?: (file: File | null) => void
}

function matchesAccept(file: File, accept: string): boolean {
  const rules = accept
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean)
  if (rules.length === 0) return true
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return rules.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule)
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1))
    return type === rule
  })
}

function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
}

export const FileDropZone = forwardRef<HTMLInputElement, FileDropZoneProps>(function FileDropZone(
  {
    label,
    hint,
    error,
    success,
    id,
    required,
    accept,
    maxBytes,
    acceptLabel = 'a supported file type',
    onChange,
    disabled,
    'aria-describedby': describedBy,
    ...rest
  },
  ref,
) {
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)

  const [file, setFile] = useState<File | null>(null)
  const [localError, setLocalError] = useState<string | undefined>()
  const [dragging, setDragging] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const shownError = error ?? localError
  const { ids, controlProps } = useFieldA11y(id, { hint, error: shownError, success }, describedBy)

  // Created in an effect and revoked in its cleanup, so a replaced or
  // unmounted file never leaks its object URL.
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function choose(next: File | null) {
    if (next === null) {
      setFile(null)
      setLocalError(undefined)
      onChange?.(null)
      return
    }
    if (accept && !matchesAccept(next, accept)) {
      setFile(null)
      setLocalError(`That file type is not supported. Choose ${acceptLabel}.`)
      onChange?.(null)
      return
    }
    if (maxBytes !== undefined && next.size > maxBytes) {
      setFile(null)
      setLocalError(`That file is ${formatMb(next.size)}. Choose one up to ${formatMb(maxBytes)}.`)
      onChange?.(null)
      return
    }
    setFile(next)
    setLocalError(undefined)
    onChange?.(next)
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null
    // Allow choosing the same file again after removing it.
    event.target.value = ''
    if (picked) choose(picked)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) choose(dropped)
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    if (!disabled) setDragging(true)
  }

  const invalidClass = shownError ? styles.invalid : ''

  return (
    <div className={fieldStyles.field}>
      <span id={titleId} className={fieldStyles.label}>
        {label}
        {required ? <RequiredMark /> : null}
      </span>
      {hint ? <FieldHint id={ids.hintId}>{hint}</FieldHint> : null}
      <input
        {...rest}
        {...controlProps}
        ref={inputRef}
        type="file"
        accept={accept}
        required={required && !file}
        disabled={disabled}
        aria-labelledby={titleId}
        tabIndex={file ? -1 : undefined}
        className={styles.input}
        onChange={handleInputChange}
      />
      {file ? (
        <div className={`${styles.chosen} ${invalidClass}`}>
          {previewUrl ? <img src={previewUrl} alt={`Preview of ${file.name}`} className={styles.preview} /> : null}
          <div className={styles.details}>
            <span className={styles.name}>{file.name}</span>
            <div className={styles.actions}>
              <Button variant="secondary" disabled={disabled} onClick={() => inputRef.current?.click()}>
                Replace
              </Button>
              <Button variant="quiet" disabled={disabled} onClick={() => choose(null)}>
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <label
          htmlFor={ids.id}
          className={`${styles.zone} ${dragging ? styles.dragging : ''} ${invalidClass}`}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <UploadIcon size={24} />
          <span className={styles.prompt}>Drag a file here, or choose one</span>
        </label>
      )}
      <FieldMessage ids={ids} error={shownError} success={success} />
    </div>
  )
})
