import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, createJob, getScript, meKey, NetworkError, scriptKey, scriptsKey } from '../../api/client'
import type { Config, Job, SavedScript } from '../../api/client'
import { Banner } from '../../components/feedback'
import { Button, FileDropZone, Select, SelectableCard, SelectableCardGroup, TextArea } from '../../components/form'
import { Card } from '../../components/layout'
import { invalidateWallet, useWallet } from '../../lib/wallet'
import { ConsentBlock, VoiceCostBox } from './ConsentBlock'
import { formatCredits } from './credits'
import { NotEnoughCredits } from './NotEnoughCredits'
import { ScriptPickerDialog } from './ScriptPickerDialog'
import picker from './ScriptPicker.module.css'
import styles from './JobForm.module.css'

type FieldName = 'image' | 'script' | 'language' | 'consent'
type FieldErrors = Partial<Record<FieldName, string>>

const FIELD_ORDER: FieldName[] = ['image', 'script', 'language', 'consent']
const BYTES_PER_MB = 1024 * 1024

function isFieldName(key: string): key is FieldName {
  return (FIELD_ORDER as string[]).includes(key)
}

/** Characters as the server counts them: Unicode code points, so an emoji is one, not two. */
function scriptLength(text: string): number {
  return [...text].length
}

/** Checks the trimmed text, as it is sent: spaces at the start and end never count. */
function validateScript(script: string, max: number): string | undefined {
  const text = script.trim()
  if (!text) return 'Please enter a script.'
  const length = scriptLength(text)
  if (length > max) {
    const over = length - max
    return `Your script is ${over} ${over === 1 ? 'character' : 'characters'} too long. Shorten it to continue.`
  }
  return undefined
}

function validateImage(file: File | null, maxMb: number): string | undefined {
  if (!file) return 'Please choose a photo.'
  if (file.size > maxMb * BYTES_PER_MB) return `That photo is too large. Choose one up to ${maxMb} MB.`
  return undefined
}

export function JobForm({
  config,
  onCreated,
  canGenerate = true,
  initialScriptId = null,
}: {
  config: Config
  onCreated: (j: Job) => void
  /** False while the email is not confirmed: the form stays usable but Generate is off. */
  canGenerate?: boolean
  /** From `?script=<id>`: a saved script to choose when the form opens. */
  initialScriptId?: string | null
}) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [script, setScript] = useState('')
  const [language, setLanguage] = useState(config.languages[0] ?? 'English')
  const [clientErrors, setClientErrors] = useState<FieldErrors>({})
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  // Once a field has been validated (on blur or submit) it is re-validated on every change.
  const [scriptChecked, setScriptChecked] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // The server's own sentence for a 402; it already states the amounts.
  const [creditsError, setCreditsError] = useState<string | null>(null)
  // The saved script the text came from, while the customer is working from one (frontend rule: script).
  const [saved, setSaved] = useState<SavedScript | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Never pre-ticked (frontend rule 6). Kept when the server answers with an error.
  const [consent, setConsent] = useState(false)
  const unchanged = saved !== null && script === saved.text && language === saved.language
  const { data: wallet } = useWallet()

  const preselect = useQuery({
    queryKey: scriptKey(initialScriptId ?? ''),
    queryFn: () => getScript(initialScriptId as string),
    enabled: !!initialScriptId,
    retry: false,
  })
  const preselected = useRef(false)
  const notEnough = !!wallet && wallet.available_credits < config.voice_price_credits

  const imageRef = useRef<HTMLInputElement>(null)
  const scriptRef = useRef<HTMLTextAreaElement>(null)
  const languageRef = useRef<HTMLSelectElement>(null)
  const consentRef = useRef<HTMLInputElement>(null)

  const create = useMutation({
    mutationFn: (v: { file: File; text: string; language: string; scriptId?: string }) =>
      createJob(v.file, v.text, v.language, v.scriptId, { consent: true, version: config.consent_version }),
  })
  const busy = create.isPending

  const setClient = (field: FieldName, message: string | undefined) =>
    setClientErrors((prev) => ({ ...prev, [field]: message }))
  const clearServer = (field: FieldName) => setServerErrors((prev) => ({ ...prev, [field]: undefined }))

  const error = (field: FieldName) => clientErrors[field] ?? serverErrors[field]

  const focusFirst = (errors: FieldErrors) => {
    const refs = { image: imageRef, script: scriptRef, language: languageRef, consent: consentRef }
    const first = FIELD_ORDER.find((f) => errors[f])
    if (first) refs[first].current?.focus()
  }

  // Choosing a saved script fills the text and the language; both stay editable.
  const applySaved = (s: SavedScript) => {
    setSaved(s)
    setScript(s.text)
    setLanguage(s.language)
    clearServer('script')
    clearServer('language')
    setClient('script', undefined)
    setPickerOpen(false)
  }

  useEffect(() => {
    if (preselect.data && !preselected.current) {
      preselected.current = true
      applySaved(preselect.data)
    }
  }, [preselect.data])

  const onImageChange = (next: File | null) => {
    setFile(next)
    clearServer('image')
    // The latest event wins: a chosen file clears our message, and a rejected file shows the drop
    // zone's own reason ("That file is 11.0 MB…"), which our older "Please choose a photo." would hide.
    setClient('image', undefined)
  }

  const onScriptChange = (value: string) => {
    setScript(value)
    clearServer('script')
    // Live validation once the field has shown an error.
    if (scriptChecked) setClient('script', validateScript(value, config.max_script_chars))
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (busy || !consent) return
    setFormError(null)
    setCreditsError(null)
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
      { file, text: script.trim(), language, scriptId: unchanged && saved ? saved.id : undefined },
      {
        onSuccess: (j) => {
          void invalidateWallet(queryClient)
          void queryClient.invalidateQueries({ queryKey: scriptsKey })
          onCreated(j)
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 403 && err.code === 'email_not_verified') {
            // Confirmed or unconfirmed elsewhere: reload who we are; the notice follows from that.
            void queryClient.invalidateQueries({ queryKey: meKey })
            return
          }
          if (err instanceof ApiError && err.code === 'insufficient_credits') {
            setCreditsError(err.message)
            void invalidateWallet(queryClient)
            return
          }
          if (err instanceof ApiError && err.code === 'script_not_found') {
            // The saved script was deleted meanwhile: keep the text; it goes as a new script next time.
            setSaved(null)
            void queryClient.invalidateQueries({ queryKey: scriptsKey })
            setFormError('That saved script no longer exists. Your text is kept and will be saved as a new script.')
            return
          }
          if (err instanceof ApiError && (err.code === 'consent_required' || err.code === 'consent_outdated')) {
            // The wording may have changed: reload it so the customer ticks the current text.
            if (err.code === 'consent_outdated') void queryClient.refetchQueries({ queryKey: ['config'] })
            setServerErrors({ consent: err.fields.consent ?? err.message })
            consentRef.current?.focus()
            return
          }
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
          <SelectableCardGroup legend="Where does the script come from?" hint={saved ? undefined : 'Choose a saved script to fill in the text and language.'}>
            <SelectableCard
              label="Write a new script"
              checked={!saved && !pickerOpen}
              onChange={() => {
                setSaved(null)
                setPickerOpen(false)
              }}
            />
            <SelectableCard
              label="Choose from my scripts"
              checked={!!saved || pickerOpen}
              onChange={() => setPickerOpen(true)}
            />
          </SelectableCardGroup>
          {preselect.isError && (
            <Banner tone="warning" title="We could not open that saved script">
              It may have been deleted. You can write a new script or choose another one.
            </Banner>
          )}
          {saved && (
            <div className={picker.choice}>
              {unchanged ? (
                <p className={picker.status}>Saved script · used as it is</p>
              ) : (
                <div className={picker.edited}>
                  <p className={picker.status}>Edited from a saved script</p>
                  <p className={picker.editedNote}>
                    You changed this saved script. Your saved script stays as it was. The new text is saved as a separate script when you continue.
                  </p>
                  <Button variant="quiet" onClick={() => applySaved(saved)}>Go back to the saved text</Button>
                </div>
              )}
              <Button variant="secondary" onClick={() => setPickerOpen(true)}>Choose a different script</Button>
            </div>
          )}
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
            {(config.languages.includes(language) ? config.languages : [...config.languages, language]).map((l) => (
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

      <ScriptPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        languages={config.languages}
        onChoose={applySaved}
        onWriteNew={() => {
          setSaved(null)
          setPickerOpen(false)
          scriptRef.current?.focus()
        }}
      />

      <Card padding="lg">
        <ConsentBlock
          ref={consentRef}
          config={config}
          checked={consent}
          error={serverErrors.consent}
          onChange={(v) => {
            setConsent(v)
            clearServer('consent')
          }}
        />
      </Card>
      <VoiceCostBox config={config} balance={wallet?.available_credits} />

      <div className={styles.footer}>
        {formError && (
          <Banner tone="danger" title="We could not generate the voice">
            {formError} Your photo and script are kept.
          </Banner>
        )}
        {notEnough && wallet ? (
          <NotEnoughCredits>
            {`You have ${formatCredits(wallet.available_credits)} credits; generating a voice costs ${formatCredits(config.voice_price_credits)}.`}
          </NotEnoughCredits>
        ) : (
          creditsError && <NotEnoughCredits>{creditsError}</NotEnoughCredits>
        )}
        {!canGenerate && (
          <p className={styles.unconfirmed}>You can fill this in now. Generating needs a confirmed email.</p>
        )}
        <p className={styles.unconfirmed}>Generating the voice costs {formatCredits(config.voice_price_credits)} credits.</p>
        <Button type="submit" size="large" busy={busy} busyLabel="Making your voice…" disabled={!canGenerate || notEnough || !consent}>
          {`Make my voice · ${formatCredits(config.voice_price_credits)} credits`}
        </Button>
        {!consent && <p className={styles.unconfirmed}>Tick the box above to continue.</p>}
      </div>
    </form>
  )
}
