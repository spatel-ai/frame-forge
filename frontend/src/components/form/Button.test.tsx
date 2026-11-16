import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders a native button with type="button" by default', () => {
    render(<Button>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
  })

  it('allows type="submit" and forwards ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button ref={ref} type="submit">
        Go
      </Button>,
    )
    expect(ref.current?.type).toBe('submit')
  })

  it('works by keyboard (Tab, Enter, Space) and shows focus', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }))
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('does not click when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('busy: sets aria-busy, blocks clicks, keeps focus and an accessible name', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick}>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    button.focus()
    rerender(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    )
    const busy = screen.getByRole('button')
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(busy)
    expect(busy.hasAttribute('disabled')).toBe(false)
    expect(busy.textContent).toContain('Save')
    expect(busy.textContent).toContain('Working…')
    await user.click(busy)
    await user.keyboard('{Enter}')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('busy: busyLabel replaces the visible label', () => {
    render(
      <Button busy busyLabel="Saving…">
        Save
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy()
  })

  it('busy submit button does not submit the form twice', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" busy>
          Pay
        </Button>
      </form>,
    )
    await user.click(screen.getByRole('button'))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
