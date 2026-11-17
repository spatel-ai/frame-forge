import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { jobListKey, listJobs } from '../../api/client'
import type { JobSummary } from '../../api/client'
import { EmptyState, ErrorState, Pill, Skeleton, SkeletonGroup } from '../../components/feedback'
import { Card } from '../../components/layout'
import { PlayIcon, PlusCircleIcon, VideoIcon } from '../../components/icons'
import { jobStatusHint, jobStatusLabel } from '../../lib/jobStatus'
import { errMsg } from '../../lib/util'
import styles from './HomePage.module.css'

export const POLL_MS = 5000
const IN_PROGRESS = { status: 'in_progress', page_size: 3 } as const
const RECENT = { status: 'ready', page_size: 6 } as const

const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

/** m:ss from seconds the server sent. */
export function formatLength(seconds: number): string {
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function InProgress() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: jobListKey(IN_PROGRESS),
    queryFn: () => listJobs(IN_PROGRESS),
    // Poll only while something is being made.
    refetchInterval: (q) => (q.state.data && q.state.data.items.length > 0 ? POLL_MS : false),
  })
  return (
    <section className={styles.section} aria-labelledby="h-progress">
      <h2 id="h-progress" className={styles.heading}>In progress</h2>
      {isPending && (
        <SkeletonGroup label="Loading videos in progress"><div className={styles.skeletonRow}><Skeleton shape="line" height={64} /></div></SkeletonGroup>
      )}
      {isError && <ErrorState title="Could not load your videos in progress" message={`${errMsg(error)}. Nothing was charged. Try again.`} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && <p className={styles.none}>Nothing is being made right now.</p>}
      {data && data.items.length > 0 && (
        <div className={styles.list}>
          {data.items.map((job) => <ProgressRow key={job.id} job={job} />)}
        </div>
      )}
    </section>
  )
}

function ProgressRow({ job }: { job: JobSummary }) {
  const hint = jobStatusHint(job.status)
  return (
    <Link to={`/create/${job.id}`} className={styles.row}>
      <span className={styles.rowIcon} aria-hidden="true"><VideoIcon size={28} /></span>
      <span className={styles.rowText}>
        <span className={styles.excerpt}>{job.script_excerpt}</span>
        {hint && <span className={styles.caption}>{hint}</span>}
      </span>
      <Pill tone="info" icon>{jobStatusLabel(job.status)}</Pill>
    </Link>
  )
}

function Recent() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: jobListKey(RECENT),
    queryFn: () => listJobs(RECENT),
  })
  return (
    <section className={styles.section} aria-labelledby="h-recent">
      <div className={styles.sectionHead}>
        <h2 id="h-recent" className={styles.heading}>Recent videos</h2>
        {data && data.items.length > 0 && <Link to="/videos" className={styles.seeAll}>See all videos</Link>}
      </div>
      {isPending && (
        <SkeletonGroup label="Loading recent videos">
          <div className={styles.grid}>
            {[0, 1, 2].map((i) => <Skeleton key={i} height={200} />)}
          </div>
        </SkeletonGroup>
      )}
      {isError && <ErrorState title="Could not load your recent videos" message={`${errMsg(error)}. Your videos are safe. Try again.`} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState icon={<VideoIcon size={28} />} title="No videos yet">Your finished videos will appear here.</EmptyState>
      )}
      {data && data.items.length > 0 && (
        <div className={styles.grid}>
          {data.items.map((job) => (
            <Link key={job.id} to={`/videos/${job.id}`} className={styles.tile}>
              <span className={styles.thumb} aria-hidden="true">
                <PlayIcon size={32} />
                {job.audio_duration_seconds != null && <span className={styles.length}>{formatLength(job.audio_duration_seconds)}</span>}
              </span>
              <span className={styles.tileText}>
                <span className={styles.excerpt}>{job.script_excerpt}</span>
                <span className={styles.caption}>{job.language} · {dateFormat.format(new Date(job.created_at))}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

export default function HomePage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Home</h1>
      <Card padding="lg">
        <div className={styles.hero}>
        <div className={styles.heroText}>
          <h2 className={styles.heroTitle}>Turn a photo and a script into a talking video</h2>
          <p className={styles.heroBody}>Upload a photo, write or pick a script, and listen to the voice before you decide to make the video.</p>
        </div>
        <Link to="/create" className={styles.linkButton}><PlusCircleIcon size={20} />Create a video</Link>
        </div>
      </Card>
      <InProgress />
      <Recent />
    </div>
  )
}
