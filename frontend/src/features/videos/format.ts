const credits = new Intl.NumberFormat('en-IN')
/** Whole credits exactly as the server sent them. No arithmetic. */
export const formatCredits = (n: number) => credits.format(n)

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
export const formatWhen = (iso: string) => when.format(new Date(iso))
const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
export const formatDay = (iso: string) => day.format(new Date(iso))

const secondsFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })
/** "17 seconds" or "4.4 seconds" from the voice length the server sent; null when unknown. One
 * decimal, so "4.4 seconds at 20 credits a second" reads true next to the price (88). */
export const formatSeconds = (s: number | null) => (s === null ? null : `${secondsFormat.format(s)} seconds`)

/** "0:17" for list rows. */
export function formatClock(s: number | null): string {
  if (s === null) return '–'
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
