import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { TextField } from './TextField'

describe('TextField', () => {
  it('associates the label with the input and passes native props through', () => {
    const ref = createRef<HTMLInputElement>()
    render(<TextField ref={ref} label="Email" type="email" name="email" autoComplete="email" />)
    const input = screen.getByLabelText('Email') as HTMLInputElement
    expect(input.type).toBe('email')
    expect(input.name).toBe('email')
    expect(ref.current).toBe(input)
  })

  it('takes focus by keyboard and accepts typing', async () => {
    const user = userEvent.setup()
    render(<TextField label="Email" />)
    await user.tab()
    const input = screen.getByLabelText('Email') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    await user.keyboard('a@b.co')
    expect(input.value).toBe('a@b.co')
  })

  it('links hint and error to the input via aria-describedby', () => {
    render(<TextField label="Email" hint="We never share it" error="Enter a valid email" />)
    const input = screen.getByLabelText('Email')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ')
    const texts = described.map((id) => document.getElementById(id)?.textContent)
    expect(texts).toEqual(['We never share it', 'Enter a valid email'])
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid email')
  })

  it('is not invalid without an error', () => {
    render(<TextField label="Email" />)
    expect(screen.getByLabelText('Email').hasAttribute('aria-invalid')).toBe(false)
  })

  it('shows a success message and references it', () => {
    render(<TextField label="Email" success="Looks good" />)
    const input = screen.getByLabelText('Email')
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Looks good')
  })

  it('marks required fields natively', () => {
    render(<TextField label="Email" required />)
    expect((screen.getByLabelText(/Email/) as HTMLInputElement).required).toBe(true)
  })

  it('can be disabled', () => {
    render(<TextField label="Email" disabled />)
    expect((screen.getByLabelText('Email') as HTMLInputElement).disabled).toBe(true)
  })
})
