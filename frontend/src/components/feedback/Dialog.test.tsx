import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog, DialogActions } from './Dialog'

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

  /** Opens the harness and moves the clock past the guard that follows opening. */
  async function openAndWait(now: { t: number }) {
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    now.t += 1000
  }
  function fakeClock() {
    const now = { t: 10_000 }
    vi.spyOn(performance, 'now').mockImplementation(() => now.t)
    return now
  }
  /** A full press on the backdrop: the press starts and ends on the <dialog> element itself. */
  function pressBackdrop(detail = 1) {
    fireEvent.pointerDown(getDialog())
    fireEvent.click(getDialog(), { detail })
  }

  it('closes on a backdrop press but not on a click inside', async () => {
    const now = fakeClock()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await openAndWait(now)
    await userEvent.click(screen.getByText('Past videos are not affected.'))
    expect(onClose).not.toHaveBeenCalled()
    pressBackdrop()
    expect(onClose).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })

  it('ignores backdrop presses when dismissable is false', async () => {
    const now = fakeClock()
    const onClose = vi.fn()
    render(<Harness dismissable={false} onClose={onClose} />)
    await openAndWait(now)
    pressBackdrop()
    expect(onClose).not.toHaveBeenCalled()
    expect(getDialog().hasAttribute('open')).toBe(true)
    vi.restoreAllMocks()
  })

  it('does not close when the second click of the opening double-click lands on the backdrop', async () => {
    const now = fakeClock()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    now.t += 60
    pressBackdrop(2)
    expect(onClose).not.toHaveBeenCalled()
    expect(getDialog().hasAttribute('open')).toBe(true)
    // A deliberate backdrop press after the guard still closes it.
    now.t += 1000
    pressBackdrop()
    expect(onClose).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })

  it('ignores any backdrop press in the first 300 ms after opening', async () => {
    const now = fakeClock()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    now.t += 250
    pressBackdrop()
    expect(onClose).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('does not close when a press starts inside and is released on the backdrop', async () => {
    const now = fakeClock()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await openAndWait(now)
    fireEvent.pointerDown(screen.getByText('Past videos are not affected.'))
    fireEvent.click(getDialog(), { detail: 1 })
    expect(onClose).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('swallows the second click of the opening double-click on a control inside, but not later clicks', async () => {
    const now = fakeClock()
    const inside = vi.fn()
    render(
      <Dialog open onClose={() => {}} title="Upload">
        <button type="button" onClick={inside}>Choose a file</button>
      </Dialog>,
    )
    const button = screen.getByRole('button', { name: 'Choose a file' })
    now.t += 80
    fireEvent.click(button, { detail: 2 })
    expect(inside).not.toHaveBeenCalled()
    // A single click, a keyboard click (detail 0), and any click after the guard all go through.
    fireEvent.click(button, { detail: 1 })
    fireEvent.click(button, { detail: 0 })
    now.t += 1000
    fireEvent.click(button, { detail: 2 })
    expect(inside).toHaveBeenCalledTimes(3)
    vi.restoreAllMocks()
  })

  it('still closes at once with Escape and the close button during the guard', async () => {
    fakeClock()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    act(() => { getDialog().dispatchEvent(new Event('cancel', { cancelable: true })) })
    expect(onClose).toHaveBeenCalledTimes(2)
    vi.restoreAllMocks()
  })

  it('shows the bottom fade only while more content is below the fold', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const body = screen.getByText('Past videos are not affected.').parentElement!.parentElement!
    const scroller = body.parentElement!
    // jsdom has no layout: content fits, so no fade.
    expect(scroller.hasAttribute('data-more-below')).toBe(false)
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 900 })
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 300 })
    fireEvent.scroll(body)
    expect(scroller.hasAttribute('data-more-below')).toBe(true)
    body.scrollTop = 600
    fireEvent.scroll(body)
    expect(scroller.hasAttribute('data-more-below')).toBe(false)
  })

  it('DialogActions keeps its buttons inside the form so they still submit it', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(
      <Dialog open onClose={() => {}} title="New script">
        <form onSubmit={onSubmit}>
          <DialogActions>
            <button type="submit">Save script</button>
          </DialogActions>
        </form>
      </Dialog>,
    )
    const save = screen.getByRole('button', { name: 'Save script' })
    expect(save.closest('form')).not.toBeNull()
    await userEvent.click(save)
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('pads the scroll container by the height of a pinned footer and drops it when the footer is not pinned', () => {
    const real = window.getComputedStyle
    let position = 'sticky'
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = real(el, pseudo)
      if (el instanceof HTMLElement && el.hasAttribute('data-dialog-footer')) {
        return { ...style, position, getPropertyValue: style.getPropertyValue.bind(style) } as CSSStyleDeclaration
      }
      return style
    })
    const Body = () => (
      <Dialog open onClose={() => {}} title="Buy credits">
        <input aria-label="Credits" />
        <DialogActions><button type="submit">Pay</button></DialogActions>
      </Dialog>
    )
    const footerHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(60)
    const { unmount } = render(<Body />)
    const footer = document.querySelector('[data-dialog-footer]')!
    const body = footer.closest('[style]') as HTMLElement
    expect(body.style.getPropertyValue('--dialog-footer-space')).toBe('68px')
    unmount()
    position = 'static'
    render(<Body />)
    const body2 = document.querySelector('[data-dialog-footer]')!.closest('[style]') as HTMLElement
    expect(body2.style.getPropertyValue('--dialog-footer-space')).toBe('0px')
    footerHeight.mockRestore()
    vi.restoreAllMocks()
  })
})
