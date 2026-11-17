import { act, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Pagination } from './Pagination'

describe('Pagination', () => {
  it('shows the range and disables Previous on the first page', () => {
    render(<Pagination page={1} pageSize={10} total={25} onPageChange={() => {}} />)
    expect(screen.getByText('Showing 1–10 of 25')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Previous/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('clamps the end of the range and disables Next on the last page', () => {
    render(<Pagination page={3} pageSize={10} total={25} onPageChange={() => {}} />)
    expect(screen.getByText('Showing 21–25 of 25')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls onPageChange with the adjacent page, by keyboard', async () => {
    const onPageChange = vi.fn()
    render(<Pagination page={2} pageSize={10} total={25} onPageChange={onPageChange} />)
    screen.getByRole('button', { name: /Next/ }).focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(screen.getByRole('button', { name: /Previous/ }))
    expect(onPageChange.mock.calls).toEqual([[3], [1]])
  })

  it('handles an empty list', () => {
    render(<Pagination page={1} pageSize={10} total={0} onPageChange={() => {}} />)
    expect(screen.getByText('Showing 0–0 of 0')).toBeTruthy()
    screen.getAllByRole('button').forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true))
  })

  function Paged({ initial = 1, withTarget = true }: { initial?: number; withTarget?: boolean }) {
    const [page, setPage] = useState(initial)
    const ref = useRef<HTMLHeadingElement>(null)
    return (
      <>
        <h2 ref={ref}>Your scripts</h2>
        <button type="button" onClick={() => setPage(1)}>Search</button>
        <Pagination page={page} pageSize={10} total={45} onPageChange={setPage} scrollTargetRef={withTarget ? ref : undefined} />
      </>
    )
  }

  it('after Next or Previous, scrolls the target to the top and moves focus to it', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    render(<Paged />)
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    const heading = screen.getByRole('heading', { name: 'Your scripts' })
    expect(screen.getByText('Showing 11–20 of 45')).toBeTruthy()
    expect(document.activeElement).toBe(heading)
    expect(heading.getAttribute('tabindex')).toBe('-1')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    await userEvent.click(screen.getByRole('button', { name: /Previous/ }))
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('uses an instant scroll when the customer prefers reduced motion', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q })) as unknown as typeof window.matchMedia
    render(<Paged />)
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    window.matchMedia = original
  })

  it('does not move scroll or focus when the page changes for another reason', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    render(<Paged initial={3} />)
    const search = screen.getByRole('button', { name: 'Search' })
    await userEvent.click(search)
    expect(screen.getByText('Showing 1–10 of 45')).toBeTruthy()
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(search)
  })

  it('without a target it behaves as before', async () => {
    render(<Paged withTarget={false} />)
    const next = screen.getByRole('button', { name: /Next/ })
    await userEvent.click(next)
    expect(document.activeElement).toBe(next)
  })

  it('drops the request when the page never arrives, so a later change does not scroll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    function Stuck() {
      const [page, setPage] = useState(1)
      const ref = useRef<HTMLHeadingElement>(null)
      return (
        <>
          <h2 ref={ref}>List</h2>
          <button type="button" onClick={() => setPage(2)}>Elsewhere</button>
          <Pagination page={page} pageSize={10} total={45} onPageChange={() => {}} scrollTargetRef={ref} />
        </>
      )
    }
    render(<Stuck />)
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    act(() => { vi.advanceTimersByTime(11_000) })
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.getByText('Showing 11–20 of 45')).toBeTruthy()
    expect(scrollIntoView).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('drops the request when another page arrives first', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    function Jumpy() {
      const [page, setPage] = useState(1)
      const ref = useRef<HTMLHeadingElement>(null)
      return (
        <>
          <h2 ref={ref}>List</h2>
          <button type="button" onClick={() => setPage(3)}>Three</button>
          <button type="button" onClick={() => setPage(2)}>Two</button>
          <Pagination page={page} pageSize={10} total={45} onPageChange={() => {}} scrollTargetRef={ref} />
        </>
      )
    }
    render(<Jumpy />)
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Three' }))
    await userEvent.click(screen.getByRole('button', { name: 'Two' }))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
