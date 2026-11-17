import { Link, useOutletContext, useParams } from 'react-router'
import type { Job } from '../../api/client'
import type { ShellContext } from '../../components/AppShell'
import NotFound from '../../components/NotFound'
import { ErrorState, Pill, Skeleton, SkeletonGroup } from '../../components/feedback'
import { DownloadIcon } from '../../components/icons'
import { Card } from '../../components/layout'
import { errMsg } from '../../lib/util'
import { FailureEnding } from './FailureEnding'
import { formatCredits, formatSeconds, formatWhen } from './format'
import { isNotFound, useVideo } from './videosQueries'
import styles from './videos.module.css'

const statusLabel = (j: Job) => (j.status === 'completed' ? 'Ready' : j.status === 'failed' ? 'Failed' : 'In progress')

function Cost({ job, creditsPerSecond }: { job: Job; creditsPerSecond: number | null }) {
  const secs = formatSeconds(job.audio_duration_seconds)
  const hasBanner = Boolean(job.start_template || job.end_template)
  return (
    <Card title="What it cost" padding="lg">
      <dl className={styles.facts}>
        <div className={styles.fact}><dt>Voice</dt><dd>{formatCredits(job.voice_credits)} credits</dd></div>
        <div className={styles.fact}>
          <dt>Video{secs && creditsPerSecond !== null ? `, ${secs} at ${formatCredits(creditsPerSecond)} credits a second` : ''}</dt>
          <dd>{formatCredits(job.video_credits)} credits</dd>
        </div>
        {hasBanner && <div className={styles.fact}><dt>Banners</dt><dd>Free</dd></div>}
        <div className={`${styles.fact} ${styles.total}`}><dt>Total</dt><dd>{formatCredits(job.charged_credits)} credits</dd></div>
      </dl>
    </Card>
  )
}

export default function VideoDetailPage() {
  const { jobId = '' } = useParams()
  const { config } = useOutletContext<ShellContext>()
  const query = useVideo(jobId)
  const job = query.data

  if (query.isPending) {
    return (
      <SkeletonGroup label="Loading your video">
        <h1 className={styles.title}>Video</h1>
        <Skeleton height={320} />
        <Skeleton height={120} />
      </SkeletonGroup>
    )
  }
  if (isNotFound(query.error)) return <NotFound />
  if (!job) {
    return <ErrorState title="We could not load this video" message={errMsg(query.error)} onRetry={() => void query.refetch()} />
  }

  const back = <Link className={styles.textLink} to="/videos">All videos</Link>

  if (job.status === 'failed') {
    return (
      <section className={styles.page} aria-labelledby="h-video">
        {back}
        <h1 id="h-video" className={styles.title}>Video</h1>
        <FailureEnding job={job} config={config} />
      </section>
    )
  }

  if (job.status !== 'completed') {
    return (
      <section className={styles.page} aria-labelledby="h-video">
        {back}
        <h1 id="h-video" className={styles.title}>Video</h1>
        <Card padding="lg">
          <div className={styles.ending}>
            <p>This video is still being made.</p>
            <div className={styles.actions}>
              <Link className={styles.linkButton} to={`/create/${job.id}`}>See its progress</Link>
            </div>
          </div>
        </Card>
      </section>
    )
  }

  const secs = formatSeconds(job.audio_duration_seconds)
  return (
    <section className={styles.page} aria-labelledby="h-video">
      {back}
      <h1 id="h-video" className={styles.title}>Video</h1>
      <div className={styles.detail}>
        <div className={styles.left}>
          {job.video_expired ? (
            // D-065: the provider keeps the video 30 days; the route answers 410 after that.
            <ErrorState title="This video has expired" message="This video has expired. Videos are kept for 30 days." />
          ) : job.video_url ? (
            <>
              <video className={styles.media} controls src={job.video_url} />
              <div><Pill icon tone="info">AI-generated</Pill></div>
            </>
          ) : (
            <ErrorState title="Your video file is not available" message="The video finished but we could not find its file." />
          )}
          <Card title="Script" padding="lg">
            <p className={styles.script}>{job.script}</p>
            <p className={styles.note}>This is the text used for this video. Changing or deleting a saved script does not change it.</p>
          </Card>
        </div>
        <div className={styles.right}>
          <Card title="Video details" padding="lg">
            <dl className={styles.facts}>
              <div className={styles.fact}><dt>Status</dt><dd>{statusLabel(job)}</dd></div>
              <div className={styles.fact}><dt>Made on</dt><dd>{formatWhen(job.created_at)}</dd></div>
              <div className={styles.fact}><dt>Language</dt><dd>{job.language}</dd></div>
              {secs && <div className={styles.fact}><dt>Length</dt><dd>{secs}</dd></div>}
              {job.start_template && <div className={styles.fact}><dt>Start banner</dt><dd>{job.start_template.name}</dd></div>}
              {job.end_template && <div className={styles.fact}><dt>End banner</dt><dd>{job.end_template.name}</dd></div>}
            </dl>
          </Card>
          <Cost job={job} creditsPerSecond={config?.credits_per_second ?? null} />
          <div className={styles.actions}>
            {job.video_url && !job.video_expired && (
              <a className={styles.linkButton} href={job.video_url} download>
                <DownloadIcon size={18} />
                Download video
              </a>
            )}
            <Link className={`${styles.linkButton} ${styles.secondary}`} to="/create">Create another</Link>
          </div>
        </div>
      </div>
    </section>
  )
}
