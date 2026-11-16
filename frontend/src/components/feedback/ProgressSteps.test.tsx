import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressSteps, type ProgressStep } from './ProgressSteps'

const steps: ProgressStep[] = [
  { label: 'Checking your photo', state: 'done' },
  { label: 'Creating your voice', state: 'current', hint: 'About a minute' },
  { label: 'Making the video', state: 'upcoming' },
  { label: 'Adding banners', state: 'failed' },
]

describe('ProgressSteps', () => {
  it('is a polite live status containing an ordered list', () => {
    render(<ProgressSteps steps={steps} />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(within(status).getAllByRole('listitem')).toHaveLength(4)
  })

  it('marks only the current step with aria-current', () => {
    render(<ProgressSteps steps={steps} />)
    const items = screen.getAllByRole('listitem')
    expect(items.map((i) => i.getAttribute('aria-current'))).toEqual([null, 'step', null, null])
  })

  it('names each state in words and shows the hint', () => {
    render(<ProgressSteps steps={steps} />)
    for (const word of ['Done', 'In progress', 'Waiting', 'Failed']) expect(screen.getByText(word)).toBeTruthy()
    expect(screen.getByText('About a minute')).toBeTruthy()
  })

  it('shows icons for done and failed steps', () => {
    render(<ProgressSteps steps={steps} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]!.querySelector('svg')).not.toBeNull()
    expect(items[3]!.querySelector('svg')).not.toBeNull()
  })
})
