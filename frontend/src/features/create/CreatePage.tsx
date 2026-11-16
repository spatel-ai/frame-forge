import { Navigate, useNavigate, useOutletContext } from 'react-router'
import type { Job } from '../../api/client'
import type { ShellContext } from '../../components/AppShell'
import { JobForm } from './JobForm'
import { readStoredId, storeId } from './storage'

export default function CreatePage() {
  const { config, configError } = useOutletContext<ShellContext>()
  const navigate = useNavigate()

  const stored = readStoredId()
  if (stored) return <Navigate to={`/create/${encodeURIComponent(stored)}`} replace />

  const onCreated = (j: Job) => {
    storeId(j.id)
    navigate(`/create/${encodeURIComponent(j.id)}`)
  }

  return config ? (
    <JobForm config={config} onCreated={onCreated} />
  ) : (
    <p className="muted">{configError ? `Cannot load configuration (${configError}). Retrying…` : 'Loading…'}</p>
  )
}
