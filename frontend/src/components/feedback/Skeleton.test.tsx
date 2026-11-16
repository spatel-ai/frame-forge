import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Skeleton, SkeletonGroup } from './Skeleton'

describe('Skeleton', () => {
  it('is hidden from assistive technology for every shape', () => {
    const { container } = render(
      <>
        <Skeleton shape="block" />
        <Skeleton shape="line" />
        <Skeleton shape="circle" />
      </>,
    )
    const nodes = container.querySelectorAll('span')
    expect(nodes).toHaveLength(3)
    nodes.forEach((n) => expect(n.getAttribute('aria-hidden')).toBe('true'))
  })

  it('sizes circles as squares and accepts numeric px', () => {
    const { container } = render(<Skeleton shape="circle" width={32} />)
    const el = container.querySelector('span')!
    expect(el.style.width).toBe('32px')
    expect(el.style.height).toBe('32px')
  })

  it('SkeletonGroup gives one accessible loading label', () => {
    render(<SkeletonGroup label="Loading videos"><Skeleton /></SkeletonGroup>)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(status.textContent).toContain('Loading videos')
  })
})
