import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Banner } from './Banner'

describe('Banner', () => {
  it('uses role alert for danger and role status otherwise', () => {
    const { rerender } = render(<Banner tone="danger" title="Failed" />)
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(<Banner tone="warning" title="Careful" />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('shows title, body, an icon and the action slot', () => {
    const { container } = render(
      <Banner tone="info" title="Heads up" action={<a href="/x">Learn more</a>}>Body text</Banner>,
    )
    expect(screen.getByText('Heads up')).toBeTruthy()
    expect(screen.getByText('Body text')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Learn more' })).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('dismisses with the keyboard', async () => {
    const onDismiss = vi.fn()
    render(<Banner title="Hi" onDismiss={onDismiss} />)
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('has no dismiss button unless asked', () => {
    render(<Banner title="Hi" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
