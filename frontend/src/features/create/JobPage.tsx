import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Banner, Skeleton, SkeletonGroup } from '../../components/feedback'
import { CreateLayout } from './CreateLayout'
import { isNotFound, useJob } from './jobQueries'
import { JobView } from './JobView'
import { stepForJob } from './steps'
import { storeId } from './storage'
import styles from './screens.module.css'

function JobSkeleton() {
  return (
    <SkeletonGroup label="Loading your video">
      <div className={styles.panel}>
        <Skeleton shape="line" height={28} width="40%" />
        <Skeleton height={160} />
        <Skeleton shape="line" width="70%" />
      </div>
    </SkeletonGroup>
  )
}

export default function JobPage() {
  const { jobId = '' } = useParams()
  const navigate = useNavigate()
  const { data: job, error } = useJob(jobId)

  const gone = isNotFound(error)
  useEffect(() => {
    if (gone) {
      storeId(null)
      navigate('/create', { replace: true })
    }
  }, [gone, navigate])

  const reset = () => {
    storeId(null)
    navigate('/create')
  }

  return (
    <CreateLayout step={job ? stepForJob(job) : undefined}>
      {error && !gone && <Banner tone="warning" title="Connection problem, retrying…" />}
      {job ? <JobView job={job} onReset={reset} /> : <JobSkeleton />}
    </CreateLayout>
  )
}
