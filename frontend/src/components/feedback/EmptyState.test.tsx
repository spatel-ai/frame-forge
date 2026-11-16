import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('shows title, body and the action slot', () => {
    render(<EmptyState title="No videos yet" action={<a href="/create">Create a video</a>}>Your finished videos appear here.</EmptyState>)
    expect(screen.getByRole('heading', { name: 'No videos yet' })).toBeTruthy()
    expect(screen.getByText('Your finished videos appear here.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create a video' })).toBeTruthy()
  })

  it('hides a decorative icon from assistive technology', () => {
    const { container } = render(<EmptyState title="Empty" icon={<svg />} />)
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})
