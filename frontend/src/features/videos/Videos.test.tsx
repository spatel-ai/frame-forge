import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getConfig, getJob, getMe, getWallet, listJobs } from '../../api/client'
import type { Config, Job, JobsPage, JobSummary, User } from '../../api/client'
import { routes } from '../../routes'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfig: vi.fn(),
  getMe: vi.fn(),
  getJob: vi.fn(),
  getWallet: vi.fn(),
  listJobs: vi.fn(),
}))

const config: Config = {
  provider: 'mock', max_audio_seconds: 60, max_script_chars: 100, max_image_mb: 1, languages: ['English'],
  credits_per_second: 20, voice_price_credits: 10, payments: 'mock', razorpay_key_id: null,
  min_purchase_credits: 1000, max_purchase_credits: 10000, payment_fee_bps: 200, payment_fee_gst_bps: 0,
  support_email: null, consent_version: 'v', consent_text: 'ok', daily_video_limit: 50, banners_enabled: true,
}

const job: Job = {
  id: 'job-1', status: 'completed', language: 'English', script: 'Welcome <b>to</b> our offer',
  audio_duration_seconds: 12, price_credits: 240, charged_credits: 250, voice_credits: 10, video_credits: 240,
  failure_kind: null, voice_reusable: false, video_expired: false, needs_review: false, consent_at: null, script_id: null,
  voice_from_job_id: null, start_template: null, end_template: null, banners_applied: null,
  audio_url: null, video_url: 'https://example.test/v.mp4', error: null,
  created_at: '2026-11-17T10:12:00Z', updated_at: '2026-11-17T10:15:00Z',
}

const row = (i: number, extra: Partial<JobSummary> = {}): JobSummary => ({
  id: `j${i}`, status: 'completed', language: 'English', script_excerpt: `Script number ${i}`,
  audio_duration_seconds: 17, failure_kind: null, video_expired: false, created_at: '2026-11-17T10:12:00Z', updated_at: '2026-11-17T10:12:00Z', ...extra,
})
const page = (items: JobSummary[], total = items.length, p = 1): JobsPage => ({ items, total, page: p, page_size: 10 })

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

describe('Videos list', () => {
  it('R-13: shows a loading skeleton first', async () => {
    vi.mocked(listJobs).mockReturnValue(new Promise(() => {}))
    renderAt('/videos')
    expect(await screen.findByText('Loading your videos')).toBeTruthy()
  })

  it('R-13: a customer with no videos sees the designed empty state and no filters', async () => {
    vi.mocked(listJobs).mockResolvedValue(page([]))
    renderAt('/videos')
    expect(await screen.findByText('No videos yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create a video' }).getAttribute('href')).toBe('/create')
    expect(screen.queryByLabelText('Search videos')).toBeNull()
  })

  it('R-13: an error shows a retry that loads the list', async () => {
    vi.mocked(listJobs).mockRejectedValueOnce(new ApiError(500, 'Server down', 'server_error')).mockResolvedValue(page([row(1)]))
    const user = renderAt('/videos')
    await screen.findByText('We could not load your videos')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Script number 1')).toBeTruthy()
  })

  it('R-13: rows link to the detail page, with status and length', async () => {
    vi.mocked(listJobs).mockResolvedValue(page([row(1), row(2, { status: 'failed', failure_kind: 'voice_failed' })], 14))
    renderAt('/videos')
    const link = (await screen.findByText('Script number 1')).closest('a')!
    expect(link.getAttribute('href')).toBe('/videos/j1')
    expect(within(link).getByText('0:17')).toBeTruthy()
    expect(within(link).getByText('Ready')).toBeTruthy()
    expect(screen.getByText('Failed', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('Showing 1–10 of 14')).toBeTruthy()
  })

  it('R-13: Next and Previous page through the list', async () => {
    vi.mocked(listJobs).mockImplementation(async (p) => (p?.page === 2 ? page([row(11)], 12, 2) : page([row(1)], 12, 1)))
    const user = renderAt('/videos')
    await screen.findByText('Script number 1')
    await user.click(screen.getByRole('button', { name: /Next/ }))
    expect(await screen.findByText('Script number 11')).toBeTruthy()
    expect(vi.mocked(listJobs)).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    await user.click(screen.getByRole('button', { name: /Previous/ }))
    expect(await screen.findByText('Script number 1')).toBeTruthy()
  })

  it('R-13: the status filter is sent to the server and resets to page 1', async () => {
    vi.mocked(listJobs).mockImplementation(async (p) => page([row(p?.page ?? 0)], 30, p?.page))
    const user = renderAt('/videos')
    await screen.findByText('Script number 1')
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await screen.findByText('Script number 2')
    await user.selectOptions(screen.getByLabelText('Status'), 'failed')
    expect(await screen.findByText('Script number 1')).toBeTruthy()
    expect(vi.mocked(listJobs)).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, status: 'failed' }))
  })

  it('R-13: search is debounced, sent as q, resets to page 1 and shows a no-match state', async () => {
    vi.mocked(listJobs).mockImplementation(async (p) => (p?.q ? page([]) : page([row(p?.page ?? 0)], 30, p?.page)))
    const user = renderAt('/videos')
    await screen.findByText('Script number 1')
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await screen.findByText('Script number 2')
    await user.type(screen.getByLabelText('Search videos'), 'zzz')
    // The debounce has not fired yet, so the server has not been asked for q.
    expect(vi.mocked(listJobs).mock.calls.some(([p]) => p?.q)).toBe(false)
    expect(await screen.findByText('No videos match')).toBeTruthy()
    expect(vi.mocked(listJobs)).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, q: 'zzz' }))
  })
})

describe('Video detail', () => {
  it('R-13, R-08: shows the player labelled AI-generated, and the script as plain text with its note', async () => {
    vi.mocked(getJob).mockResolvedValue(job)
    renderAt('/videos/job-1')
    await screen.findByText('AI-generated')
    expect(document.querySelector('video')?.getAttribute('src')).toBe('https://example.test/v.mp4')
    expect(screen.getByText('Welcome <b>to</b> our offer')).toBeTruthy()
    expect(document.querySelector('b')).toBeNull()
    expect(screen.getByText(/Changing or deleting a saved script does not change it/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download video' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create another' }).getAttribute('href')).toBe('/create')
  })

  it('R-13: the cost lines are exactly the server values, and Banners is absent without a banner', async () => {
    vi.mocked(getJob).mockResolvedValue(job)
    renderAt('/videos/job-1')
    await screen.findByText('What it cost')
    expect(screen.getByText('Video, 12 seconds at 20 credits a second')).toBeTruthy()
    expect(screen.getByText('10 credits')).toBeTruthy()
    expect(screen.getByText('240 credits')).toBeTruthy()
    expect(screen.getByText('250 credits')).toBeTruthy()
    expect(screen.queryByText('Banners')).toBeNull()
    expect(screen.queryByText('Start banner')).toBeNull()
  })

  it('R-13: with a banner chosen it shows the banner names and "Banners: Free"', async () => {
    vi.mocked(getJob).mockResolvedValue({ ...job, start_template: { id: 't1', name: 'Festive opening' }, end_template: null })
    renderAt('/videos/job-1')
    await screen.findByText('Festive opening')
    expect(screen.getByText('Start banner')).toBeTruthy()
    expect(screen.getByText('Banners')).toBeTruthy()
    expect(screen.getByText('Free')).toBeTruthy()
    expect(screen.queryByText('End banner')).toBeNull()
  })

  it('R-24, D-065: an expired video shows the expiry message instead of the player and no download', async () => {
    vi.mocked(getJob).mockResolvedValue({ ...job, video_expired: true })
    renderAt('/videos/job-1')
    expect(await screen.findByText('This video has expired. Videos are kept for 30 days.')).toBeTruthy()
    expect(document.querySelector('video')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Download video' })).toBeNull()
    expect(screen.getByText('What it cost')).toBeTruthy()
  })

  it('R-13: an in-progress video links to its create page', async () => {
    vi.mocked(getJob).mockResolvedValue({ ...job, status: 'video_generating', video_url: null })
    renderAt('/videos/job-1')
    const link = await screen.findByRole('link', { name: 'See its progress' })
    expect(link.getAttribute('href')).toBe('/create/job-1')
  })

  it('R-13: a missing video shows the shared not-found state', async () => {
    vi.mocked(getJob).mockRejectedValue(new ApiError(404, 'Not found', 'not_found'))
    renderAt('/videos/nope')
    expect(await screen.findByText('Page not found')).toBeTruthy()
  })

  it('R-13: a load error shows a retry', async () => {
    vi.mocked(getJob).mockRejectedValueOnce(new ApiError(500, 'Server down', 'server_error')).mockResolvedValue(job)
    const user = renderAt('/videos/job-1')
    await screen.findByText('We could not load this video')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('What it cost')).toBeTruthy()
  })

  const failed = (kind: NonNullable<Job['failure_kind']>, extra: Partial<Job> = {}): Job =>
    ({ ...job, status: 'failed', video_url: null, failure_kind: kind, ...extra })

  const cases: [NonNullable<Job['failure_kind']>, Partial<Job>, string, RegExp][] = [
    ['voice_failed', { voice_credits: 10, video_credits: 0, charged_credits: 0 }, 'We could not make your voice', /The 10 credits for the voice were returned/],
    ['voice_unknown', { voice_credits: 10, video_credits: 0, charged_credits: 0 }, 'We could not confirm your voice', /The 10 credits for the voice were returned to your wallet\. Our team/],
    ['voice_too_long', { voice_credits: 10, video_credits: 0, charged_credits: 10 }, 'Your voice is longer than a video can be', /The 10 credits for this voice were kept/],
    ['video_failed', { price_credits: 240, voice_credits: 10, video_credits: 0, charged_credits: 10 }, 'We could not make your video', /the 240 credits on hold were released\. The 10 credits for the voice were not returned/],
    ['video_unknown', { voice_credits: 10, video_credits: 240, charged_credits: 250 }, 'We could not confirm your video', /The 240 credits for the video were taken.*250 credits were charged in all/],
  ]
  it.each(cases)('R-13: failure_kind %s shows its board text, Start over and Go to Videos', async (kind, extra, title, credits) => {
    vi.mocked(getJob).mockResolvedValue(failed(kind, extra))
    renderAt('/videos/job-1')
    expect(await screen.findByText(title)).toBeTruthy()
    expect(screen.getByText(credits)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Start over' }).getAttribute('href')).toBe('/create')
    expect(screen.getByRole('link', { name: 'Go to Videos' }).getAttribute('href')).toBe('/videos')
    expect(screen.queryByText(/Make a video with this voice|Approve again/)).toBeNull()
    expect(screen.queryByRole('link', { name: /@/ })).toBeNull()
  })

  it('R-13: a paid voice that could not become a video can still be played and downloaded', async () => {
    vi.mocked(getJob).mockResolvedValue(failed('voice_too_long', { audio_url: '/api/v1/jobs/job-1/audio' }))
    renderAt('/videos/job-1')
    expect(await screen.findByText(/The voice you paid for is saved/)).toBeTruthy()
    expect(screen.getByLabelText('Your voice').getAttribute('src')).toBe('/api/v1/jobs/job-1/audio')
    const download = screen.getByRole('link', { name: 'Download voice' })
    expect(download.getAttribute('href')).toBe('/api/v1/jobs/job-1/audio')
    expect(download.hasAttribute('download')).toBe(true)
  })

  it('R-13: without a voice (it failed) there is no player', async () => {
    vi.mocked(getJob).mockResolvedValue(failed('voice_failed', { audio_url: null }))
    renderAt('/videos/job-1')
    await screen.findByText('We could not make your voice')
    expect(screen.queryByText('Download voice')).toBeNull()
  })

  it('R-13: a missing amount is worded without a number, never computed', async () => {
    vi.mocked(getJob).mockResolvedValue(failed('video_failed', { price_credits: null }))
    renderAt('/videos/job-1')
    expect(await screen.findByText(/Nothing was taken for the video: the credits on hold were released/)).toBeTruthy()
  })

  it('R-13: the support address shows only when the config has one', async () => {
    vi.mocked(getConfig).mockResolvedValue({ ...config, support_email: 'help@example.test' })
    vi.mocked(getJob).mockResolvedValue(failed('video_unknown'))
    renderAt('/videos/job-1')
    expect(await screen.findByRole('link', { name: 'help@example.test' })).toBeTruthy()
  })
})
