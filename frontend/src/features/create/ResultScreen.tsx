import type { Job } from '../../api/client'
import { ErrorState, Pill } from '../../components/feedback'
import { Button } from '../../components/form'
import { DownloadIcon } from '../../components/icons'
import { Card } from '../../components/layout'
import { formatCredits } from './credits'
import styles from './screens.module.css'

export function ResultScreen({ job, onReset }: { job: Job; onReset: () => void }) {
  if (!job.video_url) {
    return (
      <ErrorState
        title="Your video file is not available"
        message={`The video finished but we could not find its file. ${job.charged_credits === 0 ? 'Nothing was charged.' : `Charged: ${formatCredits(job.charged_credits)} credits.`} Start over to try again.`}
        action={<Button onClick={onReset}>Start over</Button>}
      />
    )
  }
  return (
    <div className={styles.grid}>
      <section className={`${styles.panel} ${styles.wide}`} aria-label="Your video">
        <video className={`${styles.media} ${styles.video}`} controls src={job.video_url} />
        <div>
          <Pill icon tone="info">AI-generated</Pill>
        </div>
      </section>
      <div className={styles.panel}>
        <Card padding="lg">
          <section className={styles.cardBody} aria-labelledby="h-ready">
            <h2 id="h-ready" className={styles.heading}>Your video is ready</h2>
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
              <a className={styles.linkButton} href={job.video_url} download>
                <DownloadIcon size={18} />
                Download video
              </a>
              <Button variant="secondary" size="large" onClick={onReset}>Create another</Button>
            </div>
          </section>
        </Card>
      </div>
    </div>
  )
}
