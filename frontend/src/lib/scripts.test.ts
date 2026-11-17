import { describe, expect, it } from 'vitest'
import type { SavedScript } from '../api/client'
import { formatLastUsed, scriptMeta } from './scripts'

const now = new Date(2026, 10, 17, 15, 0)
const s = (last: Date, text = 'x'.repeat(171)): SavedScript => ({
  id: 's', language: 'English', text, created_at: last.toISOString(), last_used_at: last.toISOString(),
})

describe('script helpers', () => {
  it('R-43 formats the last-used date as today, yesterday or a day and month', () => {
    expect(formatLastUsed(new Date(2026, 10, 17, 1).toISOString(), now)).toBe('today')
    expect(formatLastUsed(new Date(2026, 10, 16, 23).toISOString(), now)).toBe('yesterday')
    expect(formatLastUsed(new Date(2026, 10, 12, 9).toISOString(), now)).toBe('12 Nov')
    expect(formatLastUsed(new Date(2025, 10, 12, 9).toISOString(), now)).toBe('12 Nov 2025')
  })

  it('R-43 builds "Language · N characters · Last used <date>"', () => {
    expect(scriptMeta(s(new Date(2026, 10, 16, 10)), now)).toBe('English · 171 characters · Last used yesterday')
    expect(scriptMeta(s(new Date(2026, 10, 12, 10), 'a'), now)).toBe('English · 1 character · Last used 12 Nov')
    expect(scriptMeta(s(new Date(2026, 10, 12, 10), '😀😀 '), now)).toBe('English · 2 characters · Last used 12 Nov')
  })
})
