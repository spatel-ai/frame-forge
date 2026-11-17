import { useQuery } from '@tanstack/react-query'
import { ApiError, getJob } from '../../api/client'
import type { Job } from '../../api/client'

/** Shown when a request never reached the server (dropped connection). */
export const NETWORK_MESSAGE = 'We could not reach the server. Check your connection and try again.'

export const POLL_MS = 3000
const POLLING_STATUSES: readonly Job['status'][] = ['audio_generating', 'video_submitting', 'video_generating', 'video_assembling']

export const jobKey = (id: string) => ['job', id] as const

/** Failed loads of a job that never loaded before the page stops retrying by itself and offers "Try again". */
export const LOAD_RETRIES = 3

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
      // Nothing loaded yet: keep trying after a network failure, but not after a 404 and not forever.
      if (isNotFound(query.state.error) || query.state.errorUpdateCount >= LOAD_RETRIES) return false
      return POLL_MS
    },
  })
}
