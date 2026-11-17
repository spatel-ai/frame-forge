import { describe, expect, it } from 'vitest'
import { BANNER_NAME_MAX, bannerNameError } from './banners'

describe('bannerNameError', () => {
  it('R-85 counts a name like the server: code points of the trimmed name', () => {
    expect(BANNER_NAME_MAX).toBe(60)
    expect(bannerNameError('😀'.repeat(60))).toBeUndefined()
    expect(bannerNameError('😀'.repeat(61))).toBe('Use 60 characters or fewer.')
    expect(bannerNameError(`  ${'a'.repeat(60)}  `)).toBeUndefined()
    expect(bannerNameError('   ')).toBe('Give the banner a name.')
  })
})
