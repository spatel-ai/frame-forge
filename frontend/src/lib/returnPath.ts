/** Only a job page may be returned to after buying credits. Anything else is dropped. */
const RETURN_PATH = /^\/create\/[A-Za-z0-9_-]+$/

/** The `return` address from the URL if it is exactly a job page path, otherwise null. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && RETURN_PATH.test(raw) ? raw : null
}

/** The wallet address that opens the buy dialog and comes back to this job afterwards. */
export function topUpPath(jobId: string): string {
  return `/wallet?buy=1&return=${encodeURIComponent(`/create/${jobId}`)}`
}
