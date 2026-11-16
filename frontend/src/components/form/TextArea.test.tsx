import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TextArea } from './TextArea'

const counter = () => screen.getByTestId('char-counter')

describe('TextArea', () => {
  it('associates label, takes focus by keyboard and types', async () => {
    const user = userEvent.setup()
    render(<TextArea label="Script" />)
    await user.tab()
    const area = screen.getByLabelText('Script') as HTMLTextAreaElement
    expect(document.activeElement).toBe(area)
    await user.keyboard('hello')
    expect(area.value).toBe('hello')
  })

  it('shows used / max and updates as the user types', async () => {
    const user = userEvent.setup()
    render(<TextArea label="Script" max={100} />)
    expect(counter().textContent).toBe('0 / 100')
    await user.type(screen.getByLabelText('Script'), 'abcd')
    expect(counter().textContent).toBe('4 / 100')
  })

  it('counts a controlled value', () => {
    render(<TextArea label="Script" max={10} value="abc" onChange={() => {}} />)
    expect(counter().textContent).toBe('3 / 10')
  })

  it('turns warning near the limit and danger over it, without blocking typing', async () => {
    const user = userEvent.setup()
    render(<TextArea label="Script" max={10} />)
    const area = screen.getByLabelText('Script') as HTMLTextAreaElement
    await user.type(area, '12345678')
    expect(counter().dataset.state).toBe('ok')
    await user.type(area, '9')
    expect(counter().dataset.state).toBe('near')
    await user.type(area, '0')
    expect(counter().dataset.state).toBe('near')
    await user.type(area, 'x')
    expect(counter().dataset.state).toBe('over')
    expect(area.value).toBe('1234567890x')
    expect(counter().textContent).toBe('11 / 10')
  })

  it('announces politely only when a threshold is crossed', async () => {
    const user = userEvent.setup()
    render(<TextArea label="Script" max={10} />)
    const live = document.querySelector('[aria-live="polite"]') as HTMLElement
    const area = screen.getByLabelText('Script')
    await user.type(area, '12345678')
    expect(live.textContent).toBe('')
    await user.type(area, '9')
    expect(live.textContent).toBe('1 characters left')
    await user.type(area, '0')
    expect(live.textContent).toBe('1 characters left')
    await user.type(area, 'x')
    expect(live.textContent).toBe('1 characters over the limit of 10')
  })

  it('has no counter without max', () => {
    render(<TextArea label="Script" />)
    expect(screen.queryByTestId('char-counter')).toBeNull()
  })

  it('error state: aria-invalid and described by the error text', () => {
    render(<TextArea label="Script" hint="Up to 500" error="Too long" max={500} />)
    const area = screen.getByLabelText('Script')
    expect(area.getAttribute('aria-invalid')).toBe('true')
    const texts = (area.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
    expect(texts).toEqual(['Up to 500', 'Too long'])
  })

  it('can be disabled', () => {
    render(<TextArea label="Script" disabled />)
    expect((screen.getByLabelText('Script') as HTMLTextAreaElement).disabled).toBe(true)
  })
})
