import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig, getMe, getWallet, listJobs } from '../../api/client'
import type { Config, JobSummary, JobsPage, User } from '../../api/client'
import { routes } from '../../routes'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfig: vi.fn(),
  getMe: vi.fn(),
  getWallet: vi.fn(),
  listJobs: vi.fn(),
}))

const me = { id: 'u1', name: 'Asha Verma', email: 'asha@example.com', email_verified: true, role: 'user', active_sessions: 1 } as User
const config = { provider: 'mock', max_audio_seconds: 60, max_script_chars: 100, max_image_mb: 1, languages: ['English'], credits_per_second: 20, voice_price_credits: 10 } as Config
const job = (j: Partial<JobSummary>): JobSummary => ({
  id: 'j1', status: 'video_generating', language: 'English', script_excerpt: 'Welcome to our Diwali offer',
  audio_duration_seconds: 18, failure_kind: null, created_at: '2026-11-12T08:30:00Z', updated_at: '2026-11-12T08:30:00Z', ...j,
})
const page = (items: JobSummary[]): JobsPage => ({ items, total: items.length, page: 1, page_size: 6 })

let progress: () => Promise<JobsPage>
let recent: () => Promise<JobsPage>

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: ['/'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getConfig).mockResolvedValue(config)
  vi.mocked(getMe).mockResolvedValue(me)
  vi.mocked(getWallet).mockResolvedValue({ available_credits: 500, reserved_credits: 0, balance_credits: 500 })
  progress = () => Promise.resolve(page([]))
  recent = () => Promise.resolve(page([]))
  vi.mocked(listJobs).mockImplementation((p) => (p?.status === 'in_progress' ? progress() : recent()))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Home page', () => {
  it('R-13 renders Home at / inside the shell, with the server balance in the header', async () => {
    renderHome()
    expect(await screen.findByRole('heading', { name: 'Home', level: 1 })).toBeTruthy()
    expect(await within(screen.getByRole('banner')).findByText(/500/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Create a video/ }).getAttribute('href')).toBe('/create')
  })

  it('R-13 asks the server for three in-progress and six ready videos', async () => {
    renderHome()
    await screen.findByText('No videos yet')
    expect(listJobs).toHaveBeenCalledWith({ status: 'in_progress', page_size: 3 })
    expect(listJobs).toHaveBeenCalledWith({ status: 'ready', page_size: 6 })
  })

  it('R-13 shows skeletons while loading', async () => {
    progress = () => new Promise(() => {})
    recent = () => new Promise(() => {})
    renderHome()
    expect(await screen.findByText('Loading videos in progress')).toBeTruthy()
    expect(screen.getByText('Loading recent videos')).toBeTruthy()
  })

  it('R-13 shows the new-customer empty state', async () => {
    renderHome()
    expect(await screen.findByText('Nothing is being made right now.')).toBeTruthy()
    expect(await screen.findByText('No videos yet')).toBeTruthy()
    expect(screen.getByText('Your finished videos will appear here.')).toBeTruthy()
    expect(screen.queryByText('See all videos')).toBeNull()
  })

  it('R-13 shows the step label for an in-progress job and links to it', async () => {
    progress = () => Promise.resolve(page([job({ id: 'abc', status: 'video_assembling' })]))
    renderHome()
    const link = (await screen.findByText('Adding your banners')).closest('a')!
    expect(link.getAttribute('href')).toBe('/create/abc')
    expect(within(link).getByText('Welcome to our Diwali offer')).toBeTruthy()
  })

  it('R-13 shows recent videos with excerpt, language, en-IN date and m:ss length', async () => {
    recent = () => Promise.resolve(page([job({ id: 'v9', status: 'completed', audio_duration_seconds: 74, script_excerpt: 'Namaste from MG Road' })]))
    renderHome()
    const link = (await screen.findByText('Namaste from MG Road')).closest('a')!
    expect(link.getAttribute('href')).toBe('/videos/v9')
    expect(within(link).getByText('English · 12 Nov')).toBeTruthy()
    expect(within(link).getByText('1:14')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See all videos' }).getAttribute('href')).toBe('/videos')
  })

  it('R-13 shows an error with retry for each list, and retry refetches', async () => {
    recent = () => Promise.reject(new Error('Network error'))
    renderHome()
    await screen.findByText('Could not load your recent videos')
    recent = () => Promise.resolve(page([job({ id: 'v1', script_excerpt: 'Back again' })]))
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Back again')).toBeTruthy()
  })

  it('R-13 shows an in-progress error and retries', async () => {
    progress = () => Promise.reject(new Error('Network error'))
    renderHome()
    await screen.findByText('Could not load your videos in progress')
    progress = () => Promise.resolve(page([]))
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Nothing is being made right now.')).toBeTruthy()
  })

  it('R-13 polls the in-progress list every 5 s only while it has items', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    progress = vi.fn(() => Promise.resolve(page([job({})])))
    renderHome()
    await screen.findByText('Generating the video')
    const calls = () => vi.mocked(progress as ReturnType<typeof vi.fn>).mock.calls.length
    const before = calls()
    await act(async () => { await vi.advanceTimersByTimeAsync(5100) })
    await waitFor(() => expect(calls()).toBeGreaterThan(before))
    // The list empties: polling stops.
    progress = vi.fn(() => Promise.resolve(page([])))
    await act(async () => { await vi.advanceTimersByTimeAsync(5100) })
    await screen.findByText('Nothing is being made right now.')
    const after = vi.mocked(progress as ReturnType<typeof vi.fn>).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(vi.mocked(progress as ReturnType<typeof vi.fn>).mock.calls.length).toBe(after)
  })
})
