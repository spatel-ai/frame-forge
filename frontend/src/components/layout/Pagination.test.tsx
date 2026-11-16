import { render, screen } from '@testing-library/react'
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
})
