import { Link } from 'react-router'
import type { Config, Job } from '../../api/client'
import { ErrorState } from '../../components/feedback'
import { formatCredits } from './format'
import styles from './videos.module.css'

type Kind = NonNullable<Job['failure_kind']>

const n = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? formatCredits(v) : null)

/** Board texts for each failure kind. Amounts come only from the server's fields; with no value the sentence has no number. */
function texts(kind: Kind, job: Job): { title: string; what: string; credits: string; next: string } {
  const voice = n(job.voice_credits)
  const hold = n(job.price_credits)
  const video = n(job.video_credits)
  const total = n(job.charged_credits)
  switch (kind) {
    case 'voice_failed':
      return {
        title: 'We could not make your voice',
        what: 'Something went wrong while making the voice from your script.',
        credits: `The ${voice ? `${voice} credits` : 'credits'} for the voice were returned to your wallet.`,
        next: 'Start over. Making a new voice costs credits again.',
      }
    case 'voice_unknown':
      return {
        title: 'We could not confirm your voice',
        what: 'Something unexpected happened while making your voice, and no voice reached you.',
        credits: `The ${voice ? `${voice} credits` : 'credits'} for the voice were returned to your wallet. Our team will look into what went wrong.`,
        next: 'Start over. Making a new voice costs credits again.',
      }
    case 'voice_too_long':
      return {
        title: 'Your voice is longer than a video can be',
        what: 'The voice we made from your script is longer than the longest video we can make right now.',
        credits: `The ${voice ? `${voice} credits` : 'credits'} for this voice were kept, because the voice was made.`,
        next: 'Start over with a shorter script.',
      }
    case 'video_failed':
      return {
        title: 'We could not make your video',
        what: 'The video could not be finished, or it took too long, so we stopped.',
        credits: `Nothing was taken for the video: the ${hold ? `${hold} credits` : 'credits'} on hold were released. The ${voice ? `${voice} credits` : 'credits'} for the voice were not returned, because the voice was made.`,
        next: 'Start over to make a new video.',
      }
    case 'video_unknown':
      return {
        title: 'We could not confirm your video',
        what: 'Your request may have reached the video maker, but we did not get an answer, so we cannot tell whether your video was made.',
        credits: `The ${video ? `${video} credits` : 'credits'} for the video were taken, because the video may have been made.${total ? ` With the voice, ${total} credits were charged in all.` : ''} Our team will check this video within 2 working days. If no video was made, we will return the credits for the video.`,
        next: 'Start over to make a new video.',
      }
  }
}

export function FailureEnding({ job, config }: { job: Job; config: Config | null }) {
  const t = texts(job.failure_kind ?? 'video_failed', job)
  const support = config?.support_email
  return (
    <ErrorState
      title={t.title}
      message={t.what}
      action={
        <div className={styles.ending}>
          {job.audio_url && (
            <div>
              <h3>Your voice</h3>
              <p>The voice you paid for is saved with this video. You can listen to it or download it.</p>
              <audio className={styles.voice} controls src={job.audio_url} aria-label="Your voice" />
              <a className={`${styles.linkButton} ${styles.secondary}`} href={job.audio_url} download>Download voice</a>
            </div>
          )}
          <div><h3>Your credits</h3><p>{t.credits}</p></div>
          <div><h3>What you can do</h3><p>{t.next}</p></div>
          {support && <p>Questions? Write to <a className={styles.inlineLink} href={`mailto:${support}`}>{support}</a>.</p>}
          <div className={styles.actions}>
            <Link className={styles.linkButton} to="/create">Start over</Link>
            <Link className={`${styles.linkButton} ${styles.secondary}`} to="/videos">Go to Videos</Link>
          </div>
        </div>
      }
    />
  )
}
