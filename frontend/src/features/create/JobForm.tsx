import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createJob } from '../../api/client'
import type { Config, Job } from '../../api/client'
import { errMsg } from '../../lib/util'

export function JobForm({ config, onCreated }: { config: Config; onCreated: (j: Job) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [script, setScript] = useState('')
  const [language, setLanguage] = useState(config.languages[0] ?? 'English')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (!file) return setError('Please choose a photo.')
    if (file.size > config.max_image_mb * 1024 * 1024) return setError(`Image must be ${config.max_image_mb} MB or smaller.`)
    const text = script.trim()
    if (!text) return setError('Please enter a script.')
    if (text.length > config.max_script_chars) return setError(`Script must be ${config.max_script_chars} characters or fewer.`)
    setBusy(true)
    try {
      onCreated(await createJob(file, text, language))
    } catch (err) {
      setError(errMsg(err))
      setBusy(false)
    }
  }

  const over = script.length > config.max_script_chars

  return (
    <form onSubmit={onSubmit} className="card">
      <label className="field">
        <span>Photo (JPEG, PNG or WebP, up to {config.max_image_mb} MB)</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {preview && <img className="preview" src={preview} alt="Selected photo preview" />}

      <label className="field">
        <span>Script</span>
        <textarea rows={6} value={script} onChange={(e) => setScript(e.target.value)} />
        <small className={over ? 'count over' : 'count'}>
          {script.length} / {config.max_script_chars}
        </small>
      </label>

      <label className="field">
        <span>Language</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {config.languages.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </label>

      {error && <p className="error" role="alert">{error}</p>}

      <button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Generate voice'}</button>
    </form>
  )
}
