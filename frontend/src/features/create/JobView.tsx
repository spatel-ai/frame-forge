import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, approveJob } from '../../api/client'
import type { Job } from '../../api/client'
import { errMsg, usd } from '../../lib/util'
import { jobKey } from './jobQueries'

export function JobView({ job, onReset }: { job: Job; onReset: () => void }) {
  const queryClient = useQueryClient()
  const approveMutation = useMutation({
    mutationFn: () => approveJob(job.id),
    onSuccess: (j) => queryClient.setQueryData(jobKey(job.id), j),
    onError: (e) => {
      // e.g. 409: state changed elsewhere; refresh
      if (e instanceof ApiError) void queryClient.invalidateQueries({ queryKey: jobKey(job.id) })
    },
  })
  const approving = approveMutation.isPending
  const approveError = approveMutation.error ? errMsg(approveMutation.error) : null

  const approve = () => {
    if (approving) return
    approveMutation.mutate()
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
