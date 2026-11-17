import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createScript, deleteScript, getConfig, getMe, getWallet, listScripts } from '../../api/client'
import type { Config, SavedScript, ScriptsPage, User } from '../../api/client'
import { routes } from '../../routes'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfig: vi.fn(),
  getMe: vi.fn(),
  getWallet: vi.fn(),
  listScripts: vi.fn(),
  deleteScript: vi.fn(),
  createScript: vi.fn(),
}))

const config: Config = {
  provider: 'mock', max_audio_seconds: 60, max_script_chars: 800, max_image_mb: 1, languages: ['English', 'Hindi'],
  credits_per_second: 20, voice_price_credits: 10, payments: 'mock', razorpay_key_id: null,
  min_purchase_credits: 1000, max_purchase_credits: 10000, payment_fee_bps: 200, payment_fee_gst_bps: 0,
  support_email: null, consent_version: 'v', consent_text: 'ok', daily_video_limit: 50,
}

const script = (i: number, extra: Partial<SavedScript> = {}): SavedScript => ({
  id: `s${i}`, language: 'English', text: `Saved script number ${i}`,
  created_at: '2026-11-01T10:00:00Z', last_used_at: '2026-11-10T10:00:00Z', ...extra,
})
const page = (items: SavedScript[], total = items.length, p = 1): ScriptsPage => ({ items, total, page: p, page_size: 10 })

let router: ReturnType<typeof createMemoryRouter>
function renderAt(path: string) {
  router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getConfig).mockResolvedValue(config)
  vi.mocked(getWallet).mockResolvedValue({ available_credits: 500, reserved_credits: 0, balance_credits: 500 })
  vi.mocked(getMe).mockResolvedValue({ id: 'u1', name: 'Asha', email: 'a@example.com', email_verified: true, role: 'user', active_sessions: 1 } as User)
})
afterEach(() => vi.useRealTimers())

describe('My scripts', () => {
  it('R-43: shows a loading skeleton first', async () => {
    vi.mocked(listScripts).mockReturnValue(new Promise(() => {}))
    renderAt('/scripts')
    expect(await screen.findByText('Loading your scripts')).toBeTruthy()
  })

  it('R-43: the Scripts item is in the sidebar and leads to the page', async () => {
    vi.mocked(listScripts).mockResolvedValue(page([script(1)]))
    const user = renderAt('/account')
    await user.click(within(await screen.findByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Scripts' }))
    expect(await screen.findByRole('heading', { name: 'My scripts' })).toBeTruthy()
  })

  it('R-43: rows show the text, "Language · N characters · Last used", and Use this script links to Create', async () => {
    vi.mocked(listScripts).mockResolvedValue(page([script(1, { language: 'Hindi', text: 'नमस्ते' })]))
    renderAt('/scripts')
    expect(await screen.findByText('नमस्ते')).toBeTruthy()
    expect(screen.getByText(/^Hindi · 6 characters · Last used /)).toBeTruthy()
    expect(screen.getByText(/Deleting a script never changes a video you already made/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Use this script' }).getAttribute('href')).toBe('/create?script=s1')
  })

  it('R-43: script text is shown as plain text, never as markup', async () => {
    vi.mocked(listScripts).mockResolvedValue(page([script(1, { text: 'Hello <b>bold</b>' })]))
    renderAt('/scripts')
    expect(await screen.findByText('Hello <b>bold</b>')).toBeTruthy()
    expect(document.querySelector('b')).toBeNull()
  })

  it('R-43: a customer with no scripts sees the designed empty state and no filters', async () => {
    vi.mocked(listScripts).mockResolvedValue(page([]))
    renderAt('/scripts')
    expect(await screen.findByText('No saved scripts yet')).toBeTruthy()
    expect(screen.getByText('The first script you use to make a video is saved here, so you can use it again.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create a video' }).getAttribute('href')).toBe('/create')
    expect(screen.queryByLabelText('Search scripts')).toBeNull()
  })

  it('R-43: an error shows a retry that loads the list', async () => {
    vi.mocked(listScripts).mockRejectedValueOnce(new ApiError(500, 'Server down', 'server_error')).mockResolvedValue(page([script(1)]))
    const user = renderAt('/scripts')
    await screen.findByText('We could not load your scripts')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Saved script number 1')).toBeTruthy()
  })

  it('R-43: the search is sent to the server after a pause, and no match has its own state', async () => {
    vi.mocked(listScripts).mockImplementation(async (p) => (p?.q ? page([]) : page([script(1)])))
    const user = renderAt('/scripts')
    await screen.findByText('Saved script number 1')
    await user.type(screen.getByLabelText('Search scripts'), 'holi')
    expect(await screen.findByText('No script matches "holi"')).toBeTruthy()
    expect(vi.mocked(listScripts)).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'holi', page: 1 }))
  })

  it('R-43: the language filter comes from the config languages and is sent to the server', async () => {
    vi.mocked(listScripts).mockResolvedValue(page([script(1)]))
    const user = renderAt('/scripts')
    await screen.findByText('Saved script number 1')
    const select = screen.getByLabelText('Language')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'English', 'Hindi'])
    await user.selectOptions(select, 'Hindi')
    await vi.waitFor(() => expect(vi.mocked(listScripts)).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'Hindi', page: 1 })))
  })

  it('R-43: Next and Previous page through the list', async () => {
    vi.mocked(listScripts).mockImplementation(async (p) => (p?.page === 2 ? page([script(11)], 12, 2) : page([script(1)], 12, 1)))
    const user = renderAt('/scripts')
    await screen.findByText('Saved script number 1')
    expect(screen.getByText('Showing 1–10 of 12')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Next/ }))
    expect(await screen.findByText('Saved script number 11')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Previous/ }))
    expect(await screen.findByText('Saved script number 1')).toBeTruthy()
  })
})

describe('Delete a script', () => {
  it('R-43: Delete asks first, says videos are not affected, and Keep script deletes nothing', async () => {
    vi.mocked(listScripts).mockResolvedValue(page([script(1)]))
    const user = renderAt('/scripts')
    await user.click(await screen.findByRole('button', { name: /^Delete script: / }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete this script?')).toBeTruthy()
    expect(within(dialog).getByText(/Videos you already made are not affected/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Keep script' }))
    expect(deleteScript).not.toHaveBeenCalled()
  })

  it('R-43: confirming deletes the script and refreshes the list', async () => {
    let gone = false
    vi.mocked(listScripts).mockImplementation(async () => page(gone ? [script(2)] : [script(1), script(2)]))
    vi.mocked(deleteScript).mockImplementation(async () => { gone = true })
    const user = renderAt('/scripts')
    await user.click((await screen.findAllByRole('button', { name: /^Delete script: / }))[0])
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete script' }))
    await vi.waitFor(() => expect(screen.queryByText('Saved script number 1')).toBeNull())
    expect(deleteScript).toHaveBeenCalledWith('s1')
    expect(screen.getByText('Saved script number 2')).toBeTruthy()
  })

  it('R-43: a script already gone (404 script_not_found) closes the dialog and refreshes the list', async () => {
    let gone = false
    vi.mocked(listScripts).mockImplementation(async () => page(gone ? [] : [script(1)]))
    vi.mocked(deleteScript).mockImplementation(async () => {
      gone = true
      throw new ApiError(404, 'Script not found', 'script_not_found')
    })
    const user = renderAt('/scripts')
    await user.click(await screen.findByRole('button', { name: /^Delete script: / }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete script' }))
    expect(await screen.findByText('No saved scripts yet')).toBeTruthy()
  })

  it('R-43: another failure keeps the dialog open and says the script is still saved', async () => {
    vi.mocked(listScripts).mockResolvedValue(page([script(1)]))
    vi.mocked(deleteScript).mockRejectedValue(new ApiError(500, 'Server down', 'server_error'))
    const user = renderAt('/scripts')
    await user.click(await screen.findByRole('button', { name: /^Delete script: / }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete script' }))
    expect(await screen.findByText(/Server down/)).toBeTruthy()
    expect(screen.getByText(/The script is still saved/)).toBeTruthy()
  })
})

describe('new script', () => {
  it('R-43 New script saves without making a voice and refreshes the list', async () => {
    vi.mocked(listScripts).mockResolvedValueOnce(page([])).mockResolvedValue(page([script(1)]))
    vi.mocked(createScript).mockResolvedValue(script(1))
    renderAt('/scripts')
    await userEvent.click(await screen.findByRole('button', { name: 'New script' }))
    const d = within(await screen.findByRole('dialog'))
    expect(d.getByText(/No voice is made and no credits are taken/)).toBeTruthy()
    await userEvent.type(d.getByLabelText('What should the person say?'), 'Saved script number 1')
    await userEvent.click(d.getByRole('button', { name: 'Save script' }))
    expect(createScript).toHaveBeenCalledWith('English', 'Saved script number 1')
    expect(await screen.findByText('Saved script number 1')).toBeTruthy()
  })

  it('R-43 an empty script is refused in the browser; a server field error shows under its field and keeps the text', async () => {
    vi.mocked(listScripts).mockResolvedValue(page([]))
    vi.mocked(createScript).mockRejectedValue(
      new ApiError(422, 'Wrong alphabet', 'validation_error', { script: 'The script is written in Hindi.' }),
    )
    renderAt('/scripts')
    await userEvent.click(await screen.findByRole('button', { name: 'New script' }))
    const d = within(await screen.findByRole('dialog'))
    await userEvent.click(d.getByRole('button', { name: 'Save script' }))
    expect(await d.findByText('Type what the person should say.')).toBeTruthy()
    expect(createScript).not.toHaveBeenCalled()
    await userEvent.type(d.getByLabelText('What should the person say?'), 'नमस्ते')
    await userEvent.click(d.getByRole('button', { name: 'Save script' }))
    expect(await d.findByText('The script is written in Hindi.')).toBeTruthy()
    expect((d.getByLabelText('What should the person say?') as HTMLTextAreaElement).value).toBe('नमस्ते')
  })
})
