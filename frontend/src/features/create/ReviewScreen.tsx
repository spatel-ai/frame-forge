import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useOutletContext } from 'react-router'
import { ApiError, approveJob, bannersKey, meKey } from '../../api/client'
import type { ShellContext } from '../../components/AppShell'
import type { Job } from '../../api/client'
import { Banner } from '../../components/feedback'
import { Button } from '../../components/form'
import { Card } from '../../components/layout'
import { useBanners } from '../../lib/banners'
import { errMsg } from '../../lib/util'
import { invalidateWallet, useWallet } from '../../lib/wallet'
import { BannerPicker } from './BannerPicker'
import { formatCredits } from './credits'
import { jobKey } from './jobQueries'
import { NotEnoughCredits } from './NotEnoughCredits'
import styles from './screens.module.css'

const isNotVerified = (e: unknown) => e instanceof ApiError && e.status === 403 && e.code === 'email_not_verified'

const isInsufficient = (e: unknown) => e instanceof ApiError && e.code === 'insufficient_credits'

/** A banner the server no longer accepts: 422 on `banner_id`, or 404 `banner_not_found` (D-067). */
const isBannerError = (e: unknown) =>
  e instanceof ApiError && ((e.status === 422 && !!e.fields.banner_id) || (e.status === 404 && e.code === 'banner_not_found'))

export function ReviewScreen({ job, onReset }: { job: Job; onReset: () => void }) {
  const queryClient = useQueryClient()
  const { config } = useOutletContext<ShellContext>()
  const bannersOn = config?.banners_enabled === true
  const banners = useBanners(bannersOn)
  // Remembered for this job in component state only (D-067).
  const [bannerId, setBannerId] = useState<string | null>(null)
  const [bannerError, setBannerError] = useState<string | null>(null)
  const approveMutation = useMutation({
    mutationFn: (id: string | null) => approveJob(job.id, id ?? undefined),
    onSuccess: (j) => {
      queryClient.setQueryData(jobKey(job.id), j)
      void invalidateWallet(queryClient)
    },
    onError: (e) => {
      if (isBannerError(e)) {
        setBannerError(e instanceof ApiError ? e.fields.banner_id || e.message : '')
        setBannerId(null)
        void queryClient.invalidateQueries({ queryKey: bannersKey })
        return
      }
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
    approveMutation.error && !isNotVerified(approveMutation.error) && !isBannerError(approveMutation.error) && !creditsError ? errMsg(approveMutation.error) : null

  const needsBanner = bannersOn && !bannerId

  const approve = () => {
    if (approving) return
    if (bannersOn && !bannerId) return
    approveMutation.mutate(bannersOn ? bannerId : null)
  }

  return (
    <div className={`${styles.grid} ${styles.review}`}>
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

      <div className={`${styles.panel} ${styles.reviewSide}`}>
        {bannersOn && (
          <Card padding="lg">
            <BannerPicker
              banners={banners}
              selected={bannerId}
              onSelect={(id) => {
                setBannerId(id)
                setBannerError(null)
              }}
              error={bannerError}
              disabled={approving}
            />
          </Card>
        )}
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
              <NotEnoughCredits jobId={job.id}>
                {`This video costs ${formatCredits(price)} credits. You have ${formatCredits(wallet.available_credits)}.`}
              </NotEnoughCredits>
            ) : (
              creditsError && <NotEnoughCredits jobId={job.id}>{creditsError}</NotEnoughCredits>
            )}
            {approveError && <Banner tone="danger" title="We could not start your video">{approveError}</Banner>}
            <div className={styles.actions}>
              <Button size="large" busy={approving} busyLabel="Starting your video…" disabled={price === null || notEnough || needsBanner} onClick={approve}>
                Approve and make video
              </Button>
              <Button variant="secondary" size="large" disabled={approving} onClick={onReset}>
                Start over
              </Button>
            </div>
            {needsBanner && <p className={styles.note}>Choose a banner to continue.</p>}
            <p className={styles.note}>Credits are reserved now and only taken when your video is ready. If it fails, they are returned.</p>
          </section>
        </Card>
      </div>
    </div>
  )
}
