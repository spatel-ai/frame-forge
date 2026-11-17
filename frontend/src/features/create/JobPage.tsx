import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Banner, Skeleton, SkeletonGroup } from '../../components/feedback'
import { invalidateWallet } from '../wallet/invalidate'
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

  const queryClient = useQueryClient()

  // A capture or a release happened when the job moves to completed or failed. Compare with the
  // previous status so a plain poll never refetches the wallet.
  const status = job?.status
  const prevStatus = useRef<string | undefined>(undefined)
  useEffect(() => {
    const prev = prevStatus.current
    prevStatus.current = status
    if (prev && status && prev !== status && (status === 'completed' || status === 'failed')) {
      void invalidateWallet(queryClient)
    }
  }, [status, queryClient])

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
