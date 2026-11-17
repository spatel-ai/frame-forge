import { Navigate, useNavigate, useOutletContext } from 'react-router'
import type { Job } from '../../api/client'
import type { ShellContext } from '../../components/AppShell'
import { Banner, Skeleton, SkeletonGroup } from '../../components/feedback'
import { useMe } from '../../lib/session'
import { CreateLayout } from './CreateLayout'
import { JobForm } from './JobForm'
import { STEP_DETAILS } from './steps'
import { readStoredId, storeId } from '../../lib/jobStorage'
import styles from './JobForm.module.css'

function FormSkeleton() {
  return (
    <SkeletonGroup label="Loading the form">
      <div className={styles.sections}>
        <div className={styles.section}>
          <Skeleton shape="line" height={24} width="30%" />
          <Skeleton height={160} />
        </div>
        <div className={styles.section}>
          <Skeleton shape="line" height={24} width="30%" />
          <Skeleton height={44} />
          <Skeleton height={160} />
        </div>
      </div>
    </SkeletonGroup>
  )
}

export default function CreatePage() {
  const { config, configError } = useOutletContext<ShellContext>()
  const navigate = useNavigate()
  const { data: me } = useMe()

  const stored = readStoredId()
  if (stored) return <Navigate to={`/create/${encodeURIComponent(stored)}`} replace />

  const onCreated = (j: Job) => {
    storeId(j.id)
    navigate(`/create/${encodeURIComponent(j.id)}`)
  }

  return (
    <CreateLayout step={STEP_DETAILS}>
      {config ? (
        <JobForm config={config} onCreated={onCreated} canGenerate={!me || me.email_verified} />
      ) : (
        <>
          {configError && <Banner tone="warning" title={`Cannot load configuration (${configError}). Retrying…`} />}
          <FormSkeleton />
        </>
      )}
    </CreateLayout>
  )
}
