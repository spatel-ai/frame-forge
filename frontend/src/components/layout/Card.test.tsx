import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card } from './Card'

describe('Card', () => {
  it('titles with an h3 by default and with the requested heading level', () => {
    const { rerender } = render(<Card title="Balance">x</Card>)
    expect(screen.getByRole('heading', { name: 'Balance' }).tagName).toBe('H3')
    rerender(<Card title="Balance" headingLevel={2}>x</Card>)
    expect(screen.getByRole('heading', { name: 'Balance' }).tagName).toBe('H2')
  })

  it('renders a header with title and action slot, then content', () => {
    render(<Card title="Balance" action={<a href="/wallet">Wallet</a>}>Body</Card>)
    expect(screen.getByRole('heading', { name: 'Balance' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Wallet' })).toBeTruthy()
    expect(screen.getByText('Body')).toBeTruthy()
  })

  it('has no header without title or action', () => {
    const { container } = render(<Card>Body</Card>)
    expect(container.querySelector('header')).toBeNull()
  })

  it('accepts padding variants', () => {
    const { container } = render(<Card padding="lg">Body</Card>)
    expect(container.firstElementChild?.className).toMatch(/lg/)
  })
})
