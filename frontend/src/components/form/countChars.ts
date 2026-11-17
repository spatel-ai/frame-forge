/**
 * The number of characters the server counts for a text: Unicode code points of the trimmed text,
 * the same as Python's `len(text.strip())`. Use it in feature validators too, so the counter and the
 * error message never disagree.
 */
export function countChars(text: string): number {
  return [...text.trim()].length
}
