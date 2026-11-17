import type { Job } from '../../api/client'
import { ErrorState } from '../../components/feedback'
import { Button } from '../../components/form'
import styles from './screens.module.css'
import { formatCredits } from './credits'
import { ProgressScreen } from './ProgressScreen'
import { ResultScreen } from './ResultScreen'
import { ReviewScreen } from './ReviewScreen'

function FailedScreen({ job, onReset }: { job: Job; onReset: () => void }) {
  const voiceFailed = !job.audio_url
  return (
    <ErrorState
      headingLevel={2}
      title={voiceFailed ? 'We could not make the voice' : 'We could not make this video'}
      message={`${job.error ?? 'Something went wrong on our side.'} ${job.charged_credits === 0 ? 'Nothing was charged.' : `Charged: ${formatCredits(job.charged_credits)} credits.`} Start over to try again.`}
      action={
        <div className={styles.failActions}>
          {job.audio_url && (
            <>
              <p>The voice you paid for is saved. You can listen to it or download it.</p>
              <audio className={styles.media} controls src={job.audio_url} aria-label="Your voice" />
            </>
          )}
          <div className={styles.failButtons}>
            {job.audio_url && (
              <a className={`${styles.linkButton} ${styles.linkSecondary}`} href={job.audio_url} download>Download voice</a>
            )}
            <Button onClick={onReset}>Start over</Button>
          </div>
        </div>
      }
    />
  )
}

/** One screen per job status. */
export function JobView({ job, onReset }: { job: Job; onReset: () => void }) {
  switch (job.status) {
    case 'audio_generating':
    case 'video_submitting':
    case 'video_generating':
    case 'video_assembling':
      return <ProgressScreen status={job.status} />
    case 'audio_ready':
      return <ReviewScreen job={job} onReset={onReset} />
    case 'completed':
      return <ResultScreen job={job} onReset={onReset} />
    case 'failed':
      return <FailedScreen job={job} onReset={onReset} />
    default:
      return (
        <ErrorState
          headingLevel={2}
          title="Something unexpected happened"
          message="We do not recognise the state of this video. Start over to make a new one."
          action={<Button onClick={onReset}>Start over</Button>}
        />
      )
  }
}
