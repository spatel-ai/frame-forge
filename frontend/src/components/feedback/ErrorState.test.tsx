import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorState } from './ErrorState'

describe('ErrorState', () => {
  it('is an alert with the message and an icon', () => {
    const { container } = render(<ErrorState message="We could not load your videos. You were not charged." />)
    expect(screen.getByRole('alert').textContent).toContain('You were not charged')
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('titles with an h3 by default and with the requested heading level', () => {
    const { rerender } = render(<ErrorState title="Failed" message="m" />)
    expect(screen.getByRole('heading', { name: 'Failed' }).tagName).toBe('H3')
    rerender(<ErrorState title="Failed" message="m" headingLevel={2} />)
    expect(screen.getByRole('heading', { name: 'Failed' }).tagName).toBe('H2')
  })

  it('offers Try again by keyboard and the action slot', async () => {
    const onRetry = vi.fn()
    render(<ErrorState message="Failed" onRetry={onRetry} action={<a href="/help">Get help</a>} />)
    await userEvent.tab()
    expect(document.activeElement?.textContent).toBe('Try again')
    await userEvent.keyboard('{Enter}')
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.getByRole('link', { name: 'Get help' })).toBeTruthy()
  })

  it('shows no retry button without onRetry, and a small reference id when given', () => {
    render(<ErrorState message="Failed" referenceId="abc123" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Reference: abc123')).toBeTruthy()
  })
})
