import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Stepper } from './Stepper'

const steps = [{ label: 'Details' }, { label: 'Banners' }, { label: 'Review' }, { label: 'Result' }]

describe('Stepper', () => {
  it('is an ordered list with aria-current on the current step only', () => {
    render(<Stepper steps={steps} current={2} label="Create a video" />)
    const items = screen.getAllByRole('listitem')
    expect(screen.getByRole('list', { name: 'Create a video' })).toBeTruthy()
    expect(items.map((i) => i.getAttribute('aria-current'))).toEqual([null, 'step', null, null])
  })

  it('shows a check for done steps and numbers for the rest', () => {
    render(<Stepper steps={steps} current={3} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]!.querySelector('svg')).not.toBeNull()
    expect(items[1]!.querySelector('svg')).not.toBeNull()
    expect(items[2]!.textContent).toContain('3')
    expect(items[3]!.textContent).toContain('4')
    expect(items[3]!.querySelector('svg')).toBeNull()
  })

  it('has compact narrow-width text', () => {
    render(<Stepper steps={steps} current={2} />)
    expect(screen.getByTestId('stepper-compact').textContent).toBe('Step 2 of 4: Banners')
  })

  it('renders links only for steps with href', () => {
    render(<Stepper steps={[{ label: 'Details', href: '/create' }, { label: 'Banners' }]} current={2} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Details/ }).getAttribute('href')).toBe('/create')
  })
})
