import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import { isNotFound, useJob } from './jobQueries'
import { JobView } from './JobView'
import { storeId } from './storage'

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
    <>
      {error && !gone && <p className="warn" role="status">Connection problem, retrying…</p>}
      {job ? (
        <JobView job={job} onReset={reset} />
      ) : (
        <p className="muted"><span className="spinner" aria-hidden="true" /> Loading job…</p>
      )}
    </>
  )
}
