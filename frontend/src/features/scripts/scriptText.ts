/** The server rejects a search longer than this (HTTP 422). */
export const MAX_SEARCH_CHARS = 200
/** How much of a search is repeated in the "No script matches" heading. */
export const HEADING_QUERY_CHARS = 40

/** Characters as the server counts them (code points), not UTF-16 units. */
export const countChars = (text: string) => [...text].length

/** The first `max` characters of a search, never cutting an emoji in half. */
export const capSearch = (v: string, max = MAX_SEARCH_CHARS) => (countChars(v) > max ? [...v].slice(0, max).join('') : v)

/** The search shortened for a heading: first 40 characters and an ellipsis. */
export const shortQuery = (q: string) => (countChars(q) > HEADING_QUERY_CHARS ? `${[...q].slice(0, HEADING_QUERY_CHARS).join('')}…` : q)

/** Browser-side script check; the server makes the final decision. Returns a message, or undefined when valid. */
export function validateScriptText(text: string, maxChars: number | undefined): string | undefined {
  const t = text.trim()
  if (!t) return 'Type what the person should say.'
  if (maxChars && countChars(t) > maxChars) return `The script is longer than ${maxChars} characters. Shorten it and try again.`
  return undefined
}
