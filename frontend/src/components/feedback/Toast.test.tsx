import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast, type ToastOptions } from './Toast'

function Trigger({ options }: { options: ToastOptions }) {
  const { show } = useToast()
  return <button type="button" onClick={() => show(options)}>fire {options.message}</button>
}

function setup(...options: ToastOptions[]) {
  render(
    <ToastProvider>
      {options.map((o) => <Trigger key={o.message} options={o} />)}
    </ToastProvider>,
  )
}

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }))
  afterEach(() => vi.useRealTimers())

  it('shows a message in a polite live region', () => {
    setup({ tone: 'success', message: 'Script deleted' })
    fireEvent.click(screen.getByText('fire Script deleted'))
    const region = screen.getByTestId('toast-polite')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toContain('Script deleted')
    expect(region.querySelector('svg')).not.toBeNull()
  })

  it('puts danger toasts in the assertive region', () => {
    setup({ tone: 'danger', message: 'Could not save' })
    fireEvent.click(screen.getByText('fire Could not save'))
    expect(screen.getByTestId('toast-assertive').textContent).toContain('Could not save')
    expect(screen.getByTestId('toast-assertive').getAttribute('aria-live')).toBe('assertive')
  })

  it('auto-dismisses after the default 5 seconds', () => {
    setup({ message: 'Saved' })
    fireEvent.click(screen.getByText('fire Saved'))
    act(() => { vi.advanceTimersByTime(4900) })
    expect(screen.getByText('Saved')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('pauses on hover and resumes on leave', () => {
    setup({ message: 'Saved', duration: 1000 })
    fireEvent.click(screen.getByText('fire Saved'))
    const toast = screen.getByText('Saved').parentElement!
    act(() => { vi.advanceTimersByTime(600) })
    fireEvent.mouseEnter(toast)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByText('Saved')).toBeTruthy()
    fireEvent.mouseLeave(toast)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByText('Saved')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('pauses while focused', () => {
    setup({ message: 'Saved', duration: 1000 })
    fireEvent.click(screen.getByText('fire Saved'))
    const toast = screen.getByText('Saved').parentElement!
    fireEvent.focus(toast)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByText('Saved')).toBeTruthy()
  })

  it('runs the action and dismisses', async () => {
    vi.useRealTimers()
    const onClick = vi.fn()
    setup({ message: 'Deleted', action: { label: 'Undo', onClick } })
    await userEvent.click(screen.getByText('fire Deleted'))
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.queryByText('Deleted')).toBeNull()
  })

  it('closes with the labelled close button', async () => {
    vi.useRealTimers()
    setup({ message: 'Hello' })
    await userEvent.click(screen.getByText('fire Hello'))
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Hello')).toBeNull()
  })

  it('shows at most 3 toasts, dropping the oldest', () => {
    setup({ message: 'one' }, { message: 'two' }, { message: 'three' }, { message: 'four' })
    for (const m of ['one', 'two', 'three', 'four']) fireEvent.click(screen.getByText(`fire ${m}`))
    expect(screen.queryByText('one')).toBeNull()
    for (const m of ['two', 'three', 'four']) expect(screen.getByText(m)).toBeTruthy()
  })

  it('throws a clear error outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Trigger options={{ message: 'x' }} />)).toThrow(/ToastProvider/)
    spy.mockRestore()
  })
})
