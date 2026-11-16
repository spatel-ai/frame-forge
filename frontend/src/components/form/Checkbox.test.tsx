import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('is unchecked by default and the label toggles it', async () => {
    const user = userEvent.setup()
    render(<Checkbox label="I have the right to use this photo" />)
    const box = screen.getByLabelText('I have the right to use this photo') as HTMLInputElement
    expect(box.type).toBe('checkbox')
    expect(box.checked).toBe(false)
    await user.click(screen.getByText('I have the right to use this photo'))
    expect(box.checked).toBe(true)
  })

  it('works by keyboard: Tab to focus, Space to toggle', async () => {
    const user = userEvent.setup()
    render(<Checkbox label="Agree" />)
    await user.tab()
    const box = screen.getByLabelText('Agree') as HTMLInputElement
    expect(document.activeElement).toBe(box)
    await user.keyboard(' ')
    expect(box.checked).toBe(true)
  })

  it('error state: aria-invalid and described by the error', () => {
    render(<Checkbox label="Agree" error="You must agree to continue" />)
    const box = screen.getByLabelText('Agree')
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'You must agree to continue',
    )
  })

  it('can be disabled and does not toggle', async () => {
    const user = userEvent.setup()
    render(<Checkbox label="Agree" disabled />)
    const box = screen.getByLabelText('Agree') as HTMLInputElement
    await user.click(box)
    expect(box.disabled).toBe(true)
    expect(box.checked).toBe(false)
  })
})
