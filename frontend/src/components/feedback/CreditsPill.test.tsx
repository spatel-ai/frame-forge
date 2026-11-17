import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CreditsPill } from './CreditsPill'

describe('CreditsPill', () => {
  it('shows the balance with the word credits and thousands separators', () => {
    const { container } = render(<CreditsPill balance={1240} />)
    expect(screen.getByText('1,240 credits')).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('uses tabular figures', () => {
    render(<CreditsPill balance={500} />)
    expect(screen.getByText('500 credits').parentElement?.className).toMatch(/amount/)
  })

  it('shows a labelled skeleton while loading, no balance', () => {
    render(<CreditsPill loading />)
    expect(screen.getByRole('status').textContent).toContain('Loading credits')
    expect(screen.queryByText(/^\d[\d,]* credits$/)).toBeNull()
  })

  it('draws the figure as real text, hidden from screen readers, so it can be selected and found in the page', () => {
    const { container } = render(<CreditsPill balance={1240} />)
    const hidden = [...container.querySelectorAll('[aria-hidden="true"]')].map((el) => el.textContent)
    expect(hidden).toContain('1,240')
    expect(hidden).toContain(' credits')
    // One accessible sentence only.
    expect(screen.getAllByText('1,240 credits')).toHaveLength(1)
  })

  it('renders a link when href is given', () => {
    render(<CreditsPill balance={5} href="/wallet" />)
    expect(screen.getByRole('link', { name: '5 credits' }).getAttribute('href')).toBe('/wallet')
  })

  it('renders plain text without href', () => {
    render(<CreditsPill balance={5} low />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
