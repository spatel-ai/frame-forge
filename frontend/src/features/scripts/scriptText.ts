import { NetworkError } from '../../api/client'
import { countChars } from '../../components/form'
import { errMsg } from '../../lib/util'

/** The server rejects a search longer than this (HTTP 422). */
export const MAX_SEARCH_CHARS = 200
/** How much of a search is repeated in the "No script matches" heading. */
export const HEADING_QUERY_CHARS = 40

/** The first `max` code points of a search as typed (not trimmed), never cutting an emoji in half. */
export const capSearch = (v: string, max = MAX_SEARCH_CHARS) => {
  const points = [...v]
  return points.length > max ? points.slice(0, max).join('') : v
}

/** The search shortened for a heading: first 40 characters and an ellipsis. */
export const shortQuery = (q: string) => (countChars(q) > HEADING_QUERY_CHARS ? `${[...q.trim()].slice(0, HEADING_QUERY_CHARS).join('')}…` : q)

/** The over-limit message, or undefined when the text fits (or there is no known limit). */
export const overLimitMessage = (text: string, maxChars: number | undefined) =>
  maxChars && countChars(text) > maxChars ? `The script is longer than ${maxChars} characters. Shorten it and try again.` : undefined

/** The banner text for a failed save: two proper sentences, with the app's wording for a dropped connection. */
export function saveErrorText(err: unknown): string {
  const reason = err instanceof NetworkError
    ? 'We could not reach the server. Check your connection and try again.'
    : errMsg(err).trim()
  const stop = /[.!?]$/.test(reason) ? reason : `${reason}.`
  return err instanceof NetworkError ? `${stop} Your text is still here.` : `${stop} Your text is still here. Try again.`
}

/** Browser-side script check; the server makes the final decision. Returns a message, or undefined when valid. */
export function validateScriptText(text: string, maxChars: number | undefined): string | undefined {
  const t = text.trim()
  if (!t) return 'Type what the person should say.'
  return overLimitMessage(text, maxChars)
}
