import { useQuery } from '@tanstack/react-query'
import { ApiError, getJob } from '../../api/client'
import type { Job } from '../../api/client'

export const POLL_MS = 3000
const POLLING_STATUSES: readonly Job['status'][] = ['audio_generating', 'video_submitting', 'video_generating', 'video_assembling']

export const jobKey = (id: string) => ['job', id] as const

export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404

/** Fetches a job and keeps refetching only while it is in progress (or has not loaded yet). */
export function useJob(id: string) {
  return useQuery({
    queryKey: jobKey(id),
    queryFn: () => getJob(id),
    retry: false,
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      const job = query.state.data
      if (job) return POLLING_STATUSES.includes(job.status) ? POLL_MS : false
      // Nothing loaded yet: keep trying after a network failure, but not after a 404.
      return isNotFound(query.state.error) ? false : POLL_MS
    },
  })
}
