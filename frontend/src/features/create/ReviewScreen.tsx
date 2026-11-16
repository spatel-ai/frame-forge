import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, approveJob } from '../../api/client'
import type { Job } from '../../api/client'
import { Banner } from '../../components/feedback'
import { Button } from '../../components/form'
import { errMsg } from '../../lib/util'
import { jobKey } from './jobQueries'
import styles from './screens.module.css'

export function ReviewScreen({ job, onReset }: { job: Job; onReset: () => void }) {
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

  return (
    <div className={styles.grid}>
      <section className={styles.panel} aria-labelledby="h-voice">
        <h2 id="h-voice" className={styles.heading}>Listen to the voice</h2>
        {job.audio_url && <audio className={styles.media} controls src={job.audio_url} aria-label="Voice preview" />}
        {job.audio_duration_seconds !== null && (
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>Duration</dt>
              <dd>{job.audio_duration_seconds.toFixed(1)} seconds</dd>
            </div>
          </dl>
        )}
        <div>
          <span className={styles.label}>Script</span>
          <p className={styles.script}>{job.script}</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="h-approve">
        <h2 id="h-approve" className={styles.heading}>Approve</h2>
        <p className={styles.note}>Happy with how it sounds? Approve it and we will make the video. Otherwise start over.</p>
        {job.error && <Banner tone="danger" title="Something went wrong">{job.error}</Banner>}
        {approveError && <Banner tone="danger" title="We could not start your video">{approveError}</Banner>}
        <div className={styles.actions}>
          <Button size="large" busy={approving} busyLabel="Starting your video…" onClick={approve}>
            Approve and make video
          </Button>
          <Button variant="secondary" size="large" disabled={approving} onClick={onReset}>
            Start over
          </Button>
        </div>
      </section>
    </div>
  )
}
