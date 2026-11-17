import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig, getMe, getTransactions, getWallet, transactionsKey, walletKey } from '../../api/client'
import type { Config, LedgerEntry, Transactions, User, Wallet } from '../../api/client'
import { routes } from '../../routes'
import { invalidateWallet } from '../../lib/wallet'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfig: vi.fn(),
  getMe: vi.fn(),
  getWallet: vi.fn(),
  getTransactions: vi.fn(),
}))

const me = { id: 'u1', name: 'Asha Verma', email: 'asha@example.com', email_verified: true, role: 'user', active_sessions: 1 } as User
const config = { provider: 'mock', max_audio_seconds: 60, max_script_chars: 100, max_image_mb: 1, languages: ['English'], credits_per_second: 20, voice_price_credits: 10 } as Config
const wallet = (available: number, reserved = 0): Wallet => ({ available_credits: available, reserved_credits: reserved, balance_credits: available + reserved })
const entry = (e: Partial<LedgerEntry>): LedgerEntry => ({
  id: 'e', kind: 'grant', credits: 0, reserved_delta: 0, balance_after: 0, reserved_after: 0, job_id: null, created_at: '2026-11-17T08:30:00Z', ...e,
})
const txs = (items: LedgerEntry[], extra: Partial<Transactions> = {}): Transactions => ({ items, total: items.length, page: 1, page_size: 20, ...extra })

let router: ReturnType<typeof createMemoryRouter>
function renderAt(path = '/wallet') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  router = createMemoryRouter(routes, { initialEntries: [path] })
  return { client, ...render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>) }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getConfig).mockResolvedValue(config)
  vi.mocked(getMe).mockResolvedValue(me)
  vi.mocked(getWallet).mockResolvedValue(wallet(1234567))
  vi.mocked(getTransactions).mockResolvedValue(txs([]))
})

describe('credits pill', () => {
  it('R-13 shows the available credits in en-IN format', async () => {
    renderAt('/create')
    expect(await within(await screen.findByRole('banner')).findByText('12,34,567 credits')).toBeTruthy()
  })

  it('R-13 links the pill to /wallet', async () => {
    renderAt('/create')
    const link = (await within(await screen.findByRole('banner')).findByText('12,34,567 credits')).closest('a')!
    await userEvent.click(link)
    expect(router.state.location.pathname).toBe('/wallet')
    expect(await screen.findByRole('heading', { level: 1, name: 'Wallet' })).toBeTruthy()
  })

  it('R-13 hides the pill when the balance fails to load, and the page still works', async () => {
    vi.mocked(getWallet).mockRejectedValue(new Error('down'))
    renderAt('/create')
    expect(await screen.findByText('Asha Verma')).toBeTruthy()
    await waitFor(() => expect(getWallet).toHaveBeenCalled())
    const bar = await screen.findByRole('banner')
    await waitFor(() => expect(within(bar).queryByText('Loading credits')).toBeNull())
    expect(within(bar).queryByText(/credits/)).toBeNull()
    expect(screen.getByText(/Internal testing only/)).toBeTruthy()
  })

  it('R-13 shows a skeleton in the pill while loading', async () => {
    vi.mocked(getWallet).mockReturnValue(new Promise(() => {}))
    renderAt('/create')
    expect(await within(await screen.findByRole('banner')).findByText('Loading credits')).toBeTruthy()
  })

  it('R-13 marks Wallet as the current nav item on /wallet', async () => {
    renderAt('/wallet')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Wallet' }).getAttribute('aria-current')).toBe('page')
  })
})

describe('wallet page', () => {
  it('R-13 shows the balance, and the reserved note only when reserved is above 0', async () => {
    vi.mocked(getWallet).mockResolvedValue(wallet(1500, 40))
    const first = renderAt()
    expect(await screen.findByText('Reserved for videos in progress: 40')).toBeTruthy()
    expect(screen.getByRole('main').textContent).toContain('1,500')
    first.unmount()
    vi.mocked(getWallet).mockResolvedValue(wallet(1500, 0))
    renderAt()
    await within(await screen.findByRole('main')).findByText('credits available')
    expect(screen.queryByText(/Reserved for videos in progress/)).toBeNull()
  })

  it('R-13 describes each kind in plain English', async () => {
    const kinds: [LedgerEntry['kind'], string][] = [
      ['grant', 'Credits added'], ['purchase', 'Credits bought'], ['voice_charge', 'Voice generated'],
      ['voice_return', 'Voice failed, credits returned'], ['hold', 'Reserved for a video'], ['capture', 'Video delivered'],
      ['release', 'Video failed, credits returned'], ['adjustment', 'Adjustment'], ['refund', 'Refund'],
    ]
    vi.mocked(getTransactions).mockResolvedValue(txs(kinds.map(([kind], i) => entry({ id: `e${i}`, kind }))))
    renderAt()
    for (const [, text] of kinds) expect(await screen.findByText(text)).toBeTruthy()
  })

  it('R-13 shows signs and amounts exactly as the server sent them', async () => {
    vi.mocked(getTransactions).mockResolvedValue(txs([
      entry({ id: 'a', kind: 'grant', credits: 1000 }),
      entry({ id: 'b', kind: 'voice_charge', credits: -10 }),
      entry({ id: 'c', kind: 'hold', credits: 0, reserved_delta: 40 }),
      entry({ id: 'd', kind: 'release', credits: 0, reserved_delta: -40 }),
      entry({ id: 'e', kind: 'capture', credits: -400, reserved_delta: -400 }),
    ]))
    renderAt()
    const rows = within(await screen.findByRole('table')).getAllByRole('row').slice(1)
    const cell = (i: number) => rows[i].querySelectorAll('td')[2].textContent ?? ''
    expect(cell(0)).toBe('+1,000')
    expect(cell(1)).toBe('-10')
    expect(cell(2)).toMatch(/^40reserved/)
    expect(cell(2)).not.toContain('-')
    expect(cell(3)).toMatch(/^40no longer reserved/)
    expect(cell(3)).not.toContain('-')
    expect(cell(4)).toBe('-400')
  })

  it('R-13 links a row with a job to its job page', async () => {
    vi.mocked(getTransactions).mockResolvedValue(txs([
      entry({ id: 'a', kind: 'capture', credits: -400, job_id: 'job-9' }),
      entry({ id: 'b', kind: 'grant', credits: 5 }),
    ]))
    renderAt()
    const link = await screen.findByRole('link', { name: 'Video delivered' })
    expect(link.getAttribute('href')).toBe('/create/job-9')
    expect(screen.queryByRole('link', { name: 'Credits added' })).toBeNull()
  })

  it('R-13 asks for the next page when Next is clicked', async () => {
    vi.mocked(getTransactions).mockResolvedValue(txs([entry({ id: 'a' })], { total: 45 }))
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: /Next/ }))
    await waitFor(() => expect(getTransactions).toHaveBeenCalledWith(2, 20))
  })

  it('R-13 after a page change, scrolls the list into view and moves focus to the Transactions heading', async () => {
    vi.mocked(getTransactions).mockImplementation(async (page = 1) => txs([entry({ id: 'p' + page })], { total: 45, page }))
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: /Next/ }))
    // The scroll and the focus wait for the new page to arrive.
    await vi.waitFor(() => expect(scroll).toHaveBeenCalled())
    const heading = screen.getByRole('heading', { name: 'Transactions' })
    expect(document.activeElement).toBe(heading)
    expect(heading.getAttribute('tabindex')).toBe('-1')
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }))
  })

  it('R-13 gives the transactions table explicit table roles (kept when phones restyle it)', async () => {
    vi.mocked(getTransactions).mockResolvedValue(txs([entry({ id: 'a' })]))
    renderAt()
    const table = await screen.findByRole('table')
    expect(table.getAttribute('role')).toBe('table')
    expect(within(table).getAllByRole('rowgroup')).toHaveLength(2)
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'What happened', 'Credits'])
    expect(within(table).getAllByRole('cell')).toHaveLength(3)
  })

  it('R-13 shows the empty state with a Create a video action', async () => {
    renderAt()
    expect(await screen.findByText('No transactions yet')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Create a video' }))
    expect(router.state.location.pathname).toBe('/create')
  })

  it('R-13 shows an error state and retries', async () => {
    vi.mocked(getTransactions).mockRejectedValueOnce(new Error('Server error')).mockResolvedValue(txs([entry({ id: 'a' })]))
    renderAt()
    expect(await screen.findByRole('alert')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table')).toBeTruthy()
    expect(getTransactions).toHaveBeenCalledTimes(2)
  })

  it('R-13 shows a skeleton on first load', async () => {
    vi.mocked(getTransactions).mockReturnValue(new Promise(() => {}))
    renderAt()
    expect(await screen.findByText('Loading transactions')).toBeTruthy()
  })

  it('R-13 has one h1 and one Buy credits button', async () => {
    renderAt()
    await screen.findByText('No transactions yet')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Buy credits' })).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull() // closed until asked
  })
})

describe('top bar Buy credits link', () => {
  it('R-02 shows a Buy credits link in the top bar that points to /wallet?buy=1', async () => {
    renderAt('/create')
    const link = await within(await screen.findByRole('banner')).findByRole('link', { name: 'Buy credits' })
    expect(link.getAttribute('href')).toBe('/wallet?buy=1')
  })

  it('R-02 opens the Buy-credits dialog from the link, then removes buy=1 from the address', async () => {
    renderAt('/create')
    await userEvent.click(await within(await screen.findByRole('banner')).findByRole('link', { name: 'Buy credits' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(router.state.location.pathname).toBe('/wallet')
  })

  it('R-02 opens the dialog when /wallet?buy=1 is loaded directly', async () => {
    renderAt('/wallet?buy=1')
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('R-02 does not open the dialog on plain /wallet', async () => {
    renderAt('/wallet')
    await screen.findByText('No transactions yet')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('invalidateWallet', () => {
  it('R-13 invalidates both the wallet and the transactions', async () => {
    const client = new QueryClient()
    client.setQueryData(walletKey, wallet(1))
    client.setQueryData(transactionsKey(1, 20), txs([]))
    await invalidateWallet(client)
    expect(client.getQueryState(walletKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(transactionsKey(1, 20))?.isInvalidated).toBe(true)
  })
})
