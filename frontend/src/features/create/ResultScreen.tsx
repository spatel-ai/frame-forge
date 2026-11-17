import type { Job } from '../../api/client'
import { Banner, ErrorState, Pill } from '../../components/feedback'
import { Button, DownloadVideoButton } from '../../components/form'
import { Card } from '../../components/layout'
import { formatCredits } from './credits'
import styles from './screens.module.css'

const VIDEO_EXPIRED = 'This video has expired. Videos are kept for 30 days.'

export function ResultScreen({ job, onReset }: { job: Job; onReset: () => void }) {
  if (!job.video_url) {
    return (
      <ErrorState
        headingLevel={2}
        title="Your video file is not available"
        message={`The video finished but we could not find its file. ${job.charged_credits === 0 ? 'Nothing was charged.' : `Charged: ${formatCredits(job.charged_credits)} credits.`} Start over to try again.`}
        action={<Button onClick={onReset}>Start over</Button>}
      />
    )
  }
  return (
    <div className={`${styles.grid} ${styles.result}`}>
      <section className={`${styles.panel} ${styles.wide}`} aria-label="Your video">
        {job.video_expired ? (
          // D-065: the provider keeps the video 30 days; the route answers 410 after that.
          <ErrorState headingLevel={2} title="This video has expired" message={VIDEO_EXPIRED} />
        ) : (
          <>
            <video className={`${styles.media} ${styles.video}`} controls src={job.video_url} />
            <div>
              <Pill icon tone="info">AI-generated</Pill>
            </div>
          </>
        )}
      </section>
      <div className={styles.panel}>
        <Card padding="lg">
          <section className={styles.cardBody} aria-labelledby="h-ready">
            <h2 id="h-ready" className={styles.heading}>Your video is ready</h2>
            {job.banners_applied === false && (
              <Banner tone="warning" title="Your video is ready, but without banners">
                We could not add the banners, so this video has no opening or closing banner. The talking video itself is complete, and our team has been told.
              </Banner>
            )}
            <dl className={styles.facts}>
              {job.audio_duration_seconds !== null && (
                <div className={styles.fact}>
                  <dt>Voice length</dt>
                  <dd>{job.audio_duration_seconds.toFixed(1)} seconds</dd>
                </div>
              )}
              <div className={styles.fact}>
                <dt>Language</dt>
                <dd>{job.language}</dd>
              </div>
            </dl>
            <p className={styles.note}>Charged: {formatCredits(job.charged_credits)} credits</p>
            <div className={styles.actions}>
              {!job.video_expired && (
                <DownloadVideoButton videoPath={job.video_url} jobId={job.id} />
              )}
              <Button variant="secondary" size="large" onClick={onReset}>Create another</Button>
            </div>
          </section>
        </Card>
      </div>
    </div>
  )
}
