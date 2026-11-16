import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card } from './Card'

describe('Card', () => {
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
