import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

function Harness({ dismissable, onClose }: { dismissable?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Dialog
        open={open}
        title="Delete script"
        dismissable={dismissable}
        onClose={() => {
          onClose?.()
          setOpen(false)
        }}
      >
        <p>Past videos are not affected.</p>
      </Dialog>
    </>
  )
}

const getDialog = () => document.querySelector('dialog')!

describe('Dialog', () => {
  it('opens with showModal, linked to its title, and moves focus inside', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = getDialog()
    expect(dialog.hasAttribute('open')).toBe(true)
    const title = screen.getByRole('heading', { name: 'Delete script' })
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('is closed and empty until opened', () => {
    render(<Harness />)
    expect(getDialog().hasAttribute('open')).toBe(false)
    expect(screen.queryByText('Past videos are not affected.')).toBeNull()
  })

  it('closes with the close button and returns focus to the opener', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(opener)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(getDialog().hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('asks the parent to close on the native cancel event (Escape)', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(opener)
    const cancel = new Event('cancel', { cancelable: true })
    act(() => { getDialog().dispatchEvent(cancel) })
    expect(cancel.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(opener)
  })

  it('tells the parent when the browser closes the dialog natively', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    act(() => { getDialog().close() })
    expect(onClose).toHaveBeenCalledOnce()
    expect(getDialog().hasAttribute('open')).toBe(false)
  })

  it('does not call onClose again when the parent closes it', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on backdrop click but not on a click inside', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await userEvent.click(screen.getByText('Past videos are not affected.'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(getDialog())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ignores backdrop clicks when dismissable is false', async () => {
    const onClose = vi.fn()
    render(<Harness dismissable={false} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(getDialog())
    expect(onClose).not.toHaveBeenCalled()
    expect(getDialog().hasAttribute('open')).toBe(true)
  })
})
