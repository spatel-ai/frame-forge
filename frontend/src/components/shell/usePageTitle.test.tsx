import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { pageTitle, usePageTitle } from './usePageTitle'

function Probe() {
  usePageTitle()
  return null
}

describe('page titles (keyboard tester finding 5)', () => {
  it('names each logged-in page', () => {
    expect(pageTitle('/')).toBe('Home · Frameforge')
    expect(pageTitle('/create/abc')).toBe('Create a video · Frameforge')
    expect(pageTitle('/videos/7')).toBe('Videos · Frameforge')
    expect(pageTitle('/account')).toBe('Account · Frameforge')
    expect(pageTitle('/nope')).toBe('Page not found · Frameforge')
  })

  it('sets document.title from the route', () => {
    render(<MemoryRouter initialEntries={['/wallet']}><Probe /></MemoryRouter>)
    expect(document.title).toBe('Wallet · Frameforge')
  })
})
