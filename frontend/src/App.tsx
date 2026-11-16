import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, approveJob, createJob, getConfig, getJob } from './api'
import type { Config, Job } from './api'

const STORAGE_KEY = 'talking-avatar-job-id'
const POLL_MS = 3000
const POLLING_STATUSES = ['audio_generating', 'video_submitting', 'video_generating']

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}
function storeId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n)

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong'
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(readStoredId)
  const [job, setJob] = useState<Job | null>(null)
  const [connProblem, setConnProblem] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      getConfig().then(
        (c) => {
          if (!cancelled) {
            setConfig(c)
            setConfigError(null)
          }
        },
        (e) => {
          if (cancelled) return
          setConfigError(errMsg(e))
          setTimeout(load, POLL_MS)
        },
      )
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const reset = useCallback(() => {
    storeId(null)
    setJobId(null)
    setJob(null)
    setConnProblem(false)
  }, [])

  const shouldPoll = jobId !== null && (job === null || POLLING_STATUSES.includes(job.status))

  useEffect(() => {
    if (!jobId || !shouldPoll) return
    let cancelled = false
    const tick = async () => {
      try {
        const j = await getJob(jobId)
        if (cancelled) return
        setJob(j)
        setConnProblem(false)
      } catch (e) {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 404) {
          reset()
        } else {
          setConnProblem(true)
        }
      }
    }
    tick()
    const t = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [jobId, shouldPoll, reset])

  const onCreated = (j: Job) => {
    storeId(j.id)
    setJobId(j.id)
    setJob(j)
  }

  return (
    <main className="app">
      <header>
        <h1>Talking Avatar</h1>
        {config?.provider === 'mock' && <span className="badge">Mock mode — no real generation, no cost</span>}
      </header>

      <p className="notice">
        Internal testing only. Use only a photo of yourself, or of someone who has agreed. The output is AI-generated.
      </p>

      {connProblem && <p className="warn" role="status">Connection problem, retrying…</p>}

      {jobId === null ? (
        config ? (
          <JobForm config={config} onCreated={onCreated} />
        ) : (
          <p className="muted">{configError ? `Cannot load configuration (${configError}). Retrying…` : 'Loading…'}</p>
        )
      ) : job === null ? (
        <p className="muted"><span className="spinner" aria-hidden="true" /> Loading job…</p>
      ) : (
        <JobView job={job} onUpdate={setJob} onReset={reset} />
      )}
    </main>
  )
}

function JobForm({ config, onCreated }: { config: Config; onCreated: (j: Job) => void }) {
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

function JobView({ job, onUpdate, onReset }: { job: Job; onUpdate: (j: Job) => void; onReset: () => void }) {
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  const approve = async () => {
    if (approving) return
    setApproving(true)
    setApproveError(null)
    try {
      onUpdate(await approveJob(job.id))
    } catch (e) {
      setApproveError(errMsg(e))
      if (e instanceof ApiError) {
        // e.g. 409: state changed elsewhere; refresh
        getJob(job.id).then(onUpdate, () => {})
      }
    } finally {
      setApproving(false)
    }
  }

  switch (job.status) {
    case 'audio_generating':
      return (
        <section className="card">
          <p><span className="spinner" aria-hidden="true" /> Generating voice…</p>
        </section>
      )
    case 'audio_ready':
      return (
        <section className="card">
          <h2>Review the audio</h2>
          {job.audio_url && <audio controls src={job.audio_url} />}
          <dl>
            {job.audio_duration_seconds !== null && (<><dt>Duration</dt><dd>{job.audio_duration_seconds.toFixed(1)} s</dd></>)}
            {job.estimated_video_cost_usd !== null && (<><dt>Estimated video cost</dt><dd>{usd(job.estimated_video_cost_usd)}</dd></>)}
          </dl>
          {job.error && <p className="error" role="alert">{job.error}</p>}
          {approveError && <p className="error" role="alert">{approveError}</p>}
          <div className="actions">
            <button onClick={approve} disabled={approving}>
              {approving ? 'Submitting…' : 'Approve audio and generate video'}
            </button>
            <button className="secondary" onClick={onReset} disabled={approving}>Start over</button>
          </div>
        </section>
      )
    case 'video_submitting':
    case 'video_generating':
      return (
        <section className="card">
          <p><span className="spinner" aria-hidden="true" /> Generating video…</p>
          <p className="muted">This typically takes several minutes. You can close or reload this page safely; your job will resume.</p>
        </section>
      )
    case 'completed':
      return (
        <section className="card">
          <h2>Your video</h2>
          {job.video_url && (
            <>
              <video controls src={job.video_url} />
              <p><a href={job.video_url} download>Download video</a></p>
            </>
          )}
          <div className="actions"><button onClick={onReset}>Create another</button></div>
        </section>
      )
    case 'failed':
      return (
        <section className="card">
          <h2>Generation failed</h2>
          <p className="error" role="alert">{job.error ?? 'Unknown error'}</p>
          <div className="actions"><button onClick={onReset}>Start over</button></div>
        </section>
      )
    default:
      return (
        <section className="card">
          <p className="error">Unexpected job status: {job.status}</p>
          <div className="actions"><button onClick={onReset}>Start over</button></div>
        </section>
      )
  }
}
