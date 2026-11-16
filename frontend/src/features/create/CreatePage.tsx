import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router'
import { ApiError, getJob } from '../../api/client'
import type { Job } from '../../api/client'
import type { ShellContext } from '../../components/AppShell'
import { JobForm } from './JobForm'
import { JobView } from './JobView'

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

export default function CreatePage() {
  const { config, configError } = useOutletContext<ShellContext>()
  const [jobId, setJobId] = useState<string | null>(readStoredId)
  const [job, setJob] = useState<Job | null>(null)
  const [connProblem, setConnProblem] = useState(false)

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
    <>
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
    </>
  )
}
