import { useQuery } from '@tanstack/react-query'
import { ApiError, getJob } from '../../api/client'

// Same key as the create flow so the two share one cache entry (no cross-feature import).
export const videoKey = (id: string) => ['job', id] as const
export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404

export function useVideo(id: string) {
  return useQuery({ queryKey: videoKey(id), queryFn: () => getJob(id), retry: false })
}
