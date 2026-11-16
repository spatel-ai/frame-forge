import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { PasswordField } from './PasswordField'

describe('PasswordField', () => {
  it('hides the text by default and passes the ref and native props to the input', () => {
    const ref = createRef<HTMLInputElement>()
    render(<PasswordField ref={ref} label="Password" autoComplete="current-password" name="password" />)
    const input = screen.getByLabelText('Password') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.autocomplete).toBe('current-password')
    expect(ref.current).toBe(input)
  })

  it('shows and hides the text with the toggle, keeping what was typed', async () => {
    const user = userEvent.setup()
    render(<PasswordField label="Password" />)
    const input = screen.getByLabelText('Password') as HTMLInputElement
    await user.type(input, 'secret-value')
    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(toggle.getAttribute('aria-controls')).toBe(input.id)
    await user.click(toggle)
    expect(input.type).toBe('text')
    expect(input.value).toBe('secret-value')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input.type).toBe('password')
  })

  it('links hint and error to the input and marks it invalid', () => {
    render(<PasswordField label="Password" hint="At least 10 characters" error="Too short" />)
    const input = screen.getByLabelText('Password')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const describedBy = input.getAttribute('aria-describedby') ?? ''
    expect(describedBy).toContain(`${input.id}-hint`)
    expect(screen.getByRole('alert').textContent).toContain('Too short')
  })
})
