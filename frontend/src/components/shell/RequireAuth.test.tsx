import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMe } from '../../api/client'
import { RequireAuth } from './RequireAuth'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getMe: vi.fn(),
}))

beforeEach(() => {
  document.title = 'Frameforge'
  vi.mocked(getMe).mockReset()
})

describe('RequireAuth', () => {
  it('the session-error screen has the page title, not the bare app name', async () => {
    vi.mocked(getMe).mockRejectedValue(new TypeError('Failed to fetch'))
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/account']}><RequireAuth><p>inside</p></RequireAuth></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/Cannot reach the server/)).toBeTruthy()
    expect(document.title).toBe('Account · Frameforge')
  })
})
