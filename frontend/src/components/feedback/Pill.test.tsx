import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Pill } from './Pill'

describe('Pill', () => {
  it('renders its text for every tone', () => {
    for (const tone of ['neutral', 'info', 'success', 'warning', 'danger'] as const) {
      const { unmount } = render(<Pill tone={tone}>{tone} state</Pill>)
      expect(screen.getByText(`${tone} state`)).toBeTruthy()
      unmount()
    }
  })

  it('shows the tone icon when asked', () => {
    const { container } = render(<Pill tone="success" icon>Done</Pill>)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('has no icon by default, the word carries the state', () => {
    const { container } = render(<Pill>Draft</Pill>)
    expect(container.querySelector('svg')).toBeNull()
  })
})
