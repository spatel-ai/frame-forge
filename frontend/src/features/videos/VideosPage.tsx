import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { jobListKey, listJobs } from '../../api/client'
import type { JobListParams, JobSummary } from '../../api/client'
import { EmptyState, ErrorState, Pill, Skeleton, SkeletonGroup } from '../../components/feedback'
import type { Tone } from '../../components/feedback'
import { Select, TextField } from '../../components/form'
import { VideoIcon } from '../../components/icons'
import { Pagination } from '../../components/layout'
import { errMsg } from '../../lib/util'
import { formatClock, formatDay } from './format'
import styles from './videos.module.css'

type Status = 'all' | 'ready' | 'in_progress' | 'failed'
const PAGE_SIZE = 10
const DEBOUNCE_MS = 300

const FILTERS: { value: Status; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'failed', label: 'Failed' },
]

function statusPill(j: JobSummary): { tone: Tone; label: string } {
  if (j.status === 'completed') return { tone: 'success', label: 'Ready' }
  if (j.status === 'failed') return { tone: 'danger', label: 'Failed' }
  return { tone: 'info', label: 'In progress' }
}

export default function VideosPage() {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<Status>('all')
  const [page, setPage] = useState(1)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (search === q) return
    const t = setTimeout(() => {
      setQ(search)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search, q])

  const params: JobListParams = { page, page_size: PAGE_SIZE, status, q: q.trim() }
  const query = useQuery({ queryKey: jobListKey(params), queryFn: () => listJobs(params), placeholderData: keepPreviousData, retry: false })
  const filtered = status !== 'all' || q.trim() !== ''
  const data = query.data

  let body
  if (query.isPending) {
    body = (
      <SkeletonGroup label="Loading your videos">
        <Skeleton height={72} />
        <Skeleton height={72} />
        <Skeleton height={72} />
      </SkeletonGroup>
    )
  } else if (query.isError && !data) {
    body = <ErrorState title="We could not load your videos" message={errMsg(query.error)} onRetry={() => void query.refetch()} />
  } else if (data && data.total === 0 && !filtered) {
    body = (
      <EmptyState icon={<VideoIcon size={32} />} title="No videos yet" action={<Link className={styles.linkButton} to="/create">Create a video</Link>}>
        Your finished videos will appear here. Search and filters show up once you have made one.
      </EmptyState>
    )
  } else {
    body = null
  }

  const showControls = !(data && data.total === 0 && !filtered) && !query.isPending && !(query.isError && !data)

  return (
    <section className={styles.page} aria-labelledby="h-videos">
      <div className={styles.head}>
        <h1 id="h-videos" className={styles.title}>Videos</h1>
        {data && data.total > 0 && <Link className={styles.linkButton} to="/create">Create a video</Link>}
      </div>
      {showControls && (
        <div className={styles.controls}>
          <TextField label="Search videos" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value as Status); setPage(1) }}>
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
        </div>
      )}
      <h2 className={styles.srOnly}>Your videos</h2>
      {body}
      {data && !body && (
        data.items.length === 0 ? (
          <EmptyState icon={<VideoIcon size={32} />} title="No videos match">
            Nothing matches your search or filter. Try different words or choose All.
          </EmptyState>
        ) : (
          <>
            <ul ref={listRef} className={styles.list}>
              {data.items.map((j) => {
                const pill = statusPill(j)
                return (
                  <li key={j.id}>
                    <Link className={styles.row} to={`/videos/${j.id}`}>
                      <span className={styles.length}>{formatClock(j.audio_duration_seconds)}</span>
                      <span className={styles.main}>
                        <span className={styles.excerpt}>{j.script_excerpt}</span>
                        <span className={styles.meta}>{formatDay(j.created_at)} · {j.language}</span>
                      </span>
                      <Pill tone={pill.tone}>{pill.label}</Pill>
                    </Link>
                  </li>
                )
              })}
            </ul>
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPageChange={setPage} scrollTargetRef={listRef} />
          </>
        )
      )}
    </section>
  )
}
