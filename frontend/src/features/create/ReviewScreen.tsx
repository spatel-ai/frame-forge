import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, approveJob, meKey } from '../../api/client'
import type { Job } from '../../api/client'
import { Banner } from '../../components/feedback'
import { Button } from '../../components/form'
import { Card } from '../../components/layout'
import { errMsg } from '../../lib/util'
import { invalidateWallet } from '../wallet/invalidate'
import { useWallet } from '../wallet/useWallet'
import { formatCredits } from './credits'
import { jobKey } from './jobQueries'
import { NotEnoughCredits } from './NotEnoughCredits'
import styles from './screens.module.css'

const isNotVerified = (e: unknown) => e instanceof ApiError && e.status === 403 && e.code === 'email_not_verified'

const isInsufficient = (e: unknown) => e instanceof ApiError && e.code === 'insufficient_credits'

export function ReviewScreen({ job, onReset }: { job: Job; onReset: () => void }) {
  const queryClient = useQueryClient()
  const approveMutation = useMutation({
    mutationFn: () => approveJob(job.id),
    onSuccess: (j) => {
      queryClient.setQueryData(jobKey(job.id), j)
      void invalidateWallet(queryClient)
    },
    onError: (e) => {
      if (isInsufficient(e)) {
        void invalidateWallet(queryClient)
        return
      }
      if (isNotVerified(e)) {
        void queryClient.invalidateQueries({ queryKey: meKey })
        return
      }
      // e.g. 409: state changed elsewhere; refresh
      if (e instanceof ApiError) void queryClient.invalidateQueries({ queryKey: jobKey(job.id) })
    },
  })
  const approving = approveMutation.isPending
  const { data: wallet } = useWallet()
  const price = job.price_credits
  const notEnough = !!wallet && price !== null && wallet.available_credits < price
  const creditsError = isInsufficient(approveMutation.error) ? errMsg(approveMutation.error) : null
  const approveError =
    approveMutation.error && !isNotVerified(approveMutation.error) && !creditsError ? errMsg(approveMutation.error) : null

  const approve = () => {
    if (approving) return
    approveMutation.mutate()
  }

  return (
    <div className={styles.grid}>
      <div className={styles.panel}>
        <Card padding="lg">
          <section className={styles.cardBody} aria-labelledby="h-voice">
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
        </Card>
      </div>

      <div className={styles.panel}>
        <Card padding="lg">
          <section className={styles.cardBody} aria-labelledby="h-approve">
            <h2 id="h-approve" className={styles.heading}>Approve</h2>
            <p className={styles.note}>Happy with how it sounds? Approve it and we will make the video. Otherwise start over.</p>
            {job.error && <Banner tone="danger" title="Something went wrong">{job.error}</Banner>}
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>Video price</dt>
                <dd>{price === null ? 'Price not available yet' : `${formatCredits(price)} credits`}</dd>
              </div>
              {wallet && (
                <div className={styles.fact}>
                  <dt>Available</dt>
                  <dd>{formatCredits(wallet.available_credits)} credits</dd>
                </div>
              )}
            </dl>
            {notEnough && wallet && price !== null ? (
              <NotEnoughCredits>
                {`This video costs ${formatCredits(price)} credits. You have ${formatCredits(wallet.available_credits)}.`}
              </NotEnoughCredits>
            ) : (
              creditsError && <NotEnoughCredits>{creditsError}</NotEnoughCredits>
            )}
            {approveError && <Banner tone="danger" title="We could not start your video">{approveError}</Banner>}
            <div className={styles.actions}>
              <Button size="large" busy={approving} busyLabel="Starting your video…" disabled={price === null || notEnough} onClick={approve}>
                Approve and make video
              </Button>
              <Button variant="secondary" size="large" disabled={approving} onClick={onReset}>
                Start over
              </Button>
            </div>
            <p className={styles.note}>Credits are reserved now and only taken when your video is ready. If it fails, they are returned.</p>
          </section>
        </Card>
      </div>
    </div>
  )
}
