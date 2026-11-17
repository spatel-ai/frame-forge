import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createJob, getScript, getWallet, listScripts } from '../../api/client'
import type { Config, Job, SavedScript, ScriptsPage } from '../../api/client'
import { JobForm } from './JobForm'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  createJob: vi.fn(),
  getWallet: vi.fn(),
  listScripts: vi.fn(),
  getScript: vi.fn(),
}))

const CONSENT = { consent: true, version: '2026-11-17' }
const config: Config = {
  provider: 'mock', max_audio_seconds: 60, max_script_chars: 800, max_image_mb: 1, languages: ['English', 'Hindi'],
  credits_per_second: 20, voice_price_credits: 10, payments: 'mock', razorpay_key_id: null,
  min_purchase_credits: 1000, max_purchase_credits: 10000, payment_fee_bps: 200, payment_fee_gst_bps: 0,
  support_email: null, consent_version: '2026-11-17', consent_text: 'I have permission.', daily_video_limit: 50,
}

const job = { id: 'job-1', status: 'audio_generating' } as Job

const english: SavedScript = {
  id: 's1', language: 'English', text: 'Welcome to our Diwali offer.',
  created_at: '2026-11-01T10:00:00Z', last_used_at: '2026-11-10T10:00:00Z',
}
const hindi: SavedScript = { ...english, id: 's2', language: 'Hindi', text: 'इस हफ्ते मुफ्त डिलीवरी।' }
const page = (items: SavedScript[]): ScriptsPage => ({ items, total: items.length, page: 1, page_size: 6 })

function renderForm(initialScriptId: string | null = null) {
  const onCreated = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <JobForm config={config} onCreated={onCreated} initialScriptId={initialScriptId} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onCreated, user: userEvent.setup() }
}

const scriptBox = () => screen.getByLabelText(/what should the person say/i) as HTMLTextAreaElement
const languageBox = () => screen.getByLabelText('Language') as HTMLSelectElement
const photo = () => new File([new Uint8Array(10)], 'face.jpg', { type: 'image/jpeg' })

async function choose(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole('radio', { name: /Choose from my scripts/ }))
  const dialog = await screen.findByRole('dialog')
  await user.click(await within(dialog).findByText(text))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getWallet).mockResolvedValue({ available_credits: 500, reserved_credits: 0, balance_credits: 500 })
  vi.mocked(listScripts).mockResolvedValue(page([english, hindi]))
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})

describe('Script picker on Create', () => {
  it('R-43: offers "Write a new script" and "Choose from my scripts", with the first selected', () => {
    renderForm()
    expect((screen.getByRole('radio', { name: /Write a new script/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: /Choose from my scripts/ }) as HTMLInputElement).checked).toBe(false)
  })

  it('R-43: the picker lists saved scripts; choosing one fills the text and the language and shows "used as it is"', async () => {
    const { user } = renderForm()
    await choose(user, 'इस हफ्ते मुफ्त डिलीवरी।')
    expect(scriptBox().value).toBe('इस हफ्ते मुफ्त डिलीवरी।')
    expect(languageBox().value).toBe('Hindi')
    expect(screen.getByText('Saved script · used as it is')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('R-43: the picker searches and filters on the server', async () => {
    const { user } = renderForm()
    await user.click(screen.getByRole('radio', { name: /Choose from my scripts/ }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(english.text)
    expect(within(within(dialog).getByLabelText('Language')).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'English', 'Hindi'])
    await user.selectOptions(within(dialog).getByLabelText('Language'), 'Hindi')
    await vi.waitFor(() => expect(vi.mocked(listScripts)).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'Hindi' })))
    await user.type(within(dialog).getByLabelText('Search scripts'), 'holi')
    await vi.waitFor(() => expect(vi.mocked(listScripts)).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'holi', language: 'Hindi' })))
  })

  it('R-43: with nothing saved the picker says so and offers to write a new script', async () => {
    vi.mocked(listScripts).mockResolvedValue(page([]))
    const { user } = renderForm()
    await user.click(screen.getByRole('radio', { name: /Choose from my scripts/ }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('No saved scripts yet')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Write a new script' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getByRole('radio', { name: /Write a new script/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('R-43: a search with no result says so and Clear search brings the list back', async () => {
    vi.mocked(listScripts).mockImplementation(async (p) => (p?.q ? page([]) : page([english])))
    const { user } = renderForm()
    await user.click(screen.getByRole('radio', { name: /Choose from my scripts/ }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(english.text)
    await user.type(within(dialog).getByLabelText('Search scripts'), 'holi sale')
    expect(await within(dialog).findByText('No script matches "holi sale"')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Clear search' }))
    expect(await within(dialog).findByText(english.text)).toBeTruthy()
  })

  it('R-43: cancelling the picker leaves the form on "Write a new script"', async () => {
    const { user } = renderForm()
    await user.click(screen.getByRole('radio', { name: /Choose from my scripts/ }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getByRole('radio', { name: /Write a new script/ }) as HTMLInputElement).checked).toBe(true)
    expect(scriptBox().value).toBe('')
  })

  it('R-43: editing the text switches the label, and "Go back to the saved text" restores text and language', async () => {
    const { user } = renderForm()
    await choose(user, english.text)
    await user.type(scriptBox(), ' Offer ends Sunday.')
    expect(screen.getByText('Edited from a saved script')).toBeTruthy()
    expect(screen.queryByText('Saved script · used as it is')).toBeNull()
    await user.selectOptions(languageBox(), 'Hindi')
    await user.click(screen.getByRole('button', { name: 'Go back to the saved text' }))
    expect(scriptBox().value).toBe(english.text)
    expect(languageBox().value).toBe('English')
    expect(screen.getByText('Saved script · used as it is')).toBeTruthy()
  })

  it('R-43: changing only the language also counts as an edit', async () => {
    const { user } = renderForm()
    await choose(user, english.text)
    await user.selectOptions(languageBox(), 'Hindi')
    expect(screen.getByText('Edited from a saved script')).toBeTruthy()
  })

  it("R-43: the counter uses the configured limit (800), not the design board's 400", async () => {
    const { user } = renderForm()
    await choose(user, english.text)
    expect(screen.getByText(`${english.text.length} / 800`)).toBeTruthy()
    expect(screen.getByText(/Up to 800 characters/)).toBeTruthy()
  })
})

describe('Preselecting with ?script=<id>', () => {
  it('R-43: a script id fills the text and language from GET /scripts/{id}', async () => {
    vi.mocked(getScript).mockResolvedValue(hindi)
    renderForm('s2')
    expect(await screen.findByText('Saved script · used as it is')).toBeTruthy()
    expect(getScript).toHaveBeenCalledWith('s2')
    expect(scriptBox().value).toBe(hindi.text)
    expect(languageBox().value).toBe('Hindi')
  })

  it('R-43: an unknown script id says so and leaves the form empty', async () => {
    vi.mocked(getScript).mockRejectedValue(new ApiError(404, 'Script not found', 'script_not_found'))
    renderForm('gone')
    expect(await screen.findByText('We could not open that saved script')).toBeTruthy()
    expect(scriptBox().value).toBe('')
  })
})

describe('Submitting a saved script', () => {
  it('R-43: an unchanged saved script is sent by id', async () => {
    vi.mocked(createJob).mockResolvedValue(job)
    const { onCreated, user } = renderForm()
    const file = photo()
    await user.upload(screen.getByLabelText(/upload a photo/i), file)
    await choose(user, english.text)
    await user.click(screen.getByRole('checkbox', { name: 'I have permission.' }))
    await user.click(screen.getByRole('button', { name: 'Generate voice' }))
    expect(createJob).toHaveBeenCalledWith(file, english.text, 'English', 's1', CONSENT)
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(job))
  })

  it('R-43: an edited saved script is sent as text, without the id', async () => {
    vi.mocked(createJob).mockResolvedValue(job)
    const { user } = renderForm()
    const file = photo()
    await user.upload(screen.getByLabelText(/upload a photo/i), file)
    await choose(user, english.text)
    await user.type(scriptBox(), ' More.')
    await user.click(screen.getByRole('checkbox', { name: 'I have permission.' }))
    await user.click(screen.getByRole('button', { name: 'Generate voice' }))
    expect(createJob).toHaveBeenCalledWith(file, `${english.text} More.`, 'English', undefined, CONSENT)
  })

  it('R-43: a script deleted meanwhile (404 script_not_found) keeps the text and goes as new next time', async () => {
    vi.mocked(createJob).mockRejectedValueOnce(new ApiError(404, 'Script not found', 'script_not_found')).mockResolvedValue(job)
    const { user } = renderForm()
    const file = photo()
    await user.upload(screen.getByLabelText(/upload a photo/i), file)
    await choose(user, english.text)
    await user.click(screen.getByRole('checkbox', { name: 'I have permission.' }))
    await user.click(screen.getByRole('button', { name: 'Generate voice' }))
    expect(await screen.findByText(/no longer exists/)).toBeTruthy()
    expect(scriptBox().value).toBe(english.text)
    await user.click(screen.getByRole('button', { name: 'Generate voice' }))
    expect(createJob).toHaveBeenLastCalledWith(file, english.text, 'English', undefined, CONSENT)
  })
})
