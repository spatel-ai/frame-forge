import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, createJob, NetworkError } from '../../api/client'
import type { Config, Job } from '../../api/client'
import { Banner } from '../../components/feedback'
import { Button, FileDropZone, Select, TextArea } from '../../components/form'
import { Card } from '../../components/layout'
import styles from './JobForm.module.css'

type FieldName = 'image' | 'script' | 'language'
type FieldErrors = Partial<Record<FieldName, string>>

const FIELD_ORDER: FieldName[] = ['image', 'script', 'language']
const BYTES_PER_MB = 1024 * 1024

function isFieldName(key: string): key is FieldName {
  return (FIELD_ORDER as string[]).includes(key)
}

function validateScript(script: string, max: number): string | undefined {
  const text = script.trim()
  if (!text) return 'Please enter a script.'
  if (text.length > max) {
    const over = text.length - max
    return `Your script is ${over} ${over === 1 ? 'character' : 'characters'} too long. Shorten it to continue.`
  }
  return undefined
}

function validateImage(file: File | null, maxMb: number): string | undefined {
  if (!file) return 'Please choose a photo.'
  if (file.size > maxMb * BYTES_PER_MB) return `That photo is too large. Choose one up to ${maxMb} MB.`
  return undefined
}

export function JobForm({ config, onCreated }: { config: Config; onCreated: (j: Job) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [script, setScript] = useState('')
  const [language, setLanguage] = useState(config.languages[0] ?? 'English')
  const [clientErrors, setClientErrors] = useState<FieldErrors>({})
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  // Once a field has been validated (on blur or submit) it is re-validated on every change.
  const [scriptChecked, setScriptChecked] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const imageRef = useRef<HTMLInputElement>(null)
  const scriptRef = useRef<HTMLTextAreaElement>(null)
  const languageRef = useRef<HTMLSelectElement>(null)

  const create = useMutation({
    mutationFn: (v: { file: File; text: string; language: string }) => createJob(v.file, v.text, v.language),
  })
  const busy = create.isPending

  const setClient = (field: FieldName, message: string | undefined) =>
    setClientErrors((prev) => ({ ...prev, [field]: message }))
  const clearServer = (field: FieldName) => setServerErrors((prev) => ({ ...prev, [field]: undefined }))

  const error = (field: FieldName) => clientErrors[field] ?? serverErrors[field]

  const focusFirst = (errors: FieldErrors) => {
    const refs = { image: imageRef, script: scriptRef, language: languageRef }
    const first = FIELD_ORDER.find((f) => errors[f])
    if (first) refs[first].current?.focus()
  }

  const onImageChange = (next: File | null) => {
    setFile(next)
    clearServer('image')
    // A rejected file already shows its own message in the drop zone; only clear ours.
    if (next) setClient('image', undefined)
  }

  const onScriptChange = (value: string) => {
    setScript(value)
    clearServer('script')
    // Live validation once the field has shown an error.
    if (scriptChecked) setClient('script', validateScript(value, config.max_script_chars))
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setFormError(null)
    const errors: FieldErrors = {
      image: validateImage(file, config.max_image_mb),
      script: validateScript(script, config.max_script_chars),
    }
    setClientErrors(errors)
    setScriptChecked(true)
    setServerErrors({})
    if (errors.image || errors.script || !file) {
      focusFirst(errors)
      return
    }
    create.mutate(
      { file, text: script.trim(), language },
      {
        onSuccess: (j) => onCreated(j),
        onError: (err) => {
          const fields: FieldErrors = {}
          if (err instanceof ApiError) {
            for (const [key, msg] of Object.entries(err.fields)) if (isFieldName(key)) fields[key] = msg
          }
          if (FIELD_ORDER.some((f) => fields[f])) {
            setServerErrors(fields)
            focusFirst(fields)
            return
          }
          setFormError(
            err instanceof NetworkError
              ? 'We could not reach the server. Check your connection and try again.'
              : err instanceof Error
                ? err.message
                : 'Something went wrong. Try again.',
          )
        },
      },
    )
  }

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <div className={styles.sections}>
        <div className={styles.section}>
          <Card padding="lg">
          <section className={styles.cardBody} aria-labelledby="h-photo">
          <h2 id="h-photo" className={styles.heading}>Photo</h2>
          <FileDropZone
            ref={imageRef}
            label="Upload a photo"
            hint={`JPEG, PNG or WebP, up to ${config.max_image_mb} MB.`}
            accept="image/jpeg,image/png,image/webp"
            acceptLabel="a JPEG, PNG or WebP image"
            maxBytes={config.max_image_mb * BYTES_PER_MB}
            error={error('image')}
            onChange={onImageChange}
          />
          <ul className={styles.tips}>
            <li>One person, facing the camera, face clearly lit.</li>
            <li>Use a photo of yourself or of someone who has agreed.</li>
          </ul>
        </section>
          </Card>
        </div>

        <div className={styles.section}>
          <Card padding="lg">
          <section className={styles.cardBody} aria-labelledby="h-script">
          <h2 id="h-script" className={styles.heading}>Script</h2>
          <Select
            ref={languageRef}
            label="Language"
            hint="The language the person will speak."
            value={language}
            error={error('language')}
            onChange={(e) => {
              setLanguage(e.target.value)
              clearServer('language')
            }}
          >
            {config.languages.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </Select>
          <TextArea
            ref={scriptRef}
            label="What should the person say?"
            hint={`Up to ${config.max_script_chars} characters. The voice can run up to ${config.max_audio_seconds} seconds.`}
            rows={7}
            max={config.max_script_chars}
            value={script}
            error={error('script')}
            onChange={(e) => onScriptChange(e.target.value)}
            onBlur={() => {
              setScriptChecked(true)
              setClient('script', validateScript(script, config.max_script_chars))
            }}
          />
        </section>
          </Card>
        </div>
      </div>

      <div className={styles.footer}>
        {formError && (
          <Banner tone="danger" title="We could not generate the voice">
            {formError} Your photo and script are kept.
          </Banner>
        )}
        <Button type="submit" size="large" busy={busy} busyLabel="Generating voice…">
          Generate voice
        </Button>
      </div>
    </form>
  )
}
