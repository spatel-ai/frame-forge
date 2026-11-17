import { describe, expect, it } from 'vitest'
import { formatSeconds } from './format'

describe('formatSeconds', () => {
  it('R-13 shows one decimal so the rate line agrees with the price', () => {
    expect(formatSeconds(4.4)).toBe('4.4 seconds')
    expect(formatSeconds(12)).toBe('12 seconds')
    expect(formatSeconds(null)).toBeNull()
  })
})
