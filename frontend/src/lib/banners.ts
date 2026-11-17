import { useQuery } from '@tanstack/react-query'
import { bannersKey, listBanners } from '../api/client'

/** Shared by the Banners page and the Create picker (features may not import each other). D-067. */
export const BANNER_NAME_MAX = 60
export const BANNER_MAX_BYTES = 5 * 1024 * 1024
export const BANNER_ACCEPT = 'image/png,image/jpeg,image/webp'
export const BANNER_ACCEPT_LABEL = 'a PNG, JPEG or WebP image'

export function useBanners(enabled = true) {
  return useQuery({ queryKey: bannersKey, queryFn: async () => (await listBanners()).items, retry: false, enabled })
}

const dayMonthYear = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** "17 Nov 2026" */
export const bannerDate = (iso: string): string => dayMonthYear.format(new Date(iso))

/** Message for a name that cannot be sent, or undefined when it is fine. */
export function bannerNameError(name: string): string | undefined {
  const n = name.trim()
  if (!n) return 'Give the banner a name.'
  if (n.length > BANNER_NAME_MAX) return `Use ${BANNER_NAME_MAX} characters or fewer.`
  return undefined
}
