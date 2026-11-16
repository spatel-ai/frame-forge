/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// vitest runs from the frontend directory (npm test)
const css = readFileSync('src/styles/tokens.css', 'utf8')

// Expected values copied from docs/UX.md section 4, Colour table.
const expected: Record<string, string> = {
  '--color-primary': '#4A3AFF',
  '--color-primary-strong': '#3626D9',
  '--color-primary-soft': '#EEECFF',
  '--color-credit': '#FFB020',
  '--color-ink': '#14182B',
  '--color-ink-soft': '#4B5169',
  '--color-ink-muted': '#666C85',
  '--color-surface': '#FFFFFF',
  '--color-page': '#F4F5FA',
  '--color-line': '#DFE2EC',
  '--color-success': '#0B7A55',
  '--color-warning': '#9A5B00',
  '--color-danger': '#C7322F',
  '--color-success-soft': '#E3F5EE',
  '--color-warning-soft': '#FFF1D6',
  '--color-danger-soft': '#FDE8E7',
}

describe('tokens.css', () => {
  for (const [name, value] of Object.entries(expected)) {
    it(`defines ${name} as ${value}`, () => {
      const re = new RegExp(`${name}:\\s*${value}\\s*;`, 'i')
      expect(css).toMatch(re)
    })
  }

  it('is light only', () => {
    expect(css).toContain('color-scheme: light;')
    expect(css).not.toContain('prefers-color-scheme')
  })
})
