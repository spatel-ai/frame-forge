import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, approveJob, getConfig, getJob, getMe, getWallet, listBanners } from '../../api/client'
import type { Banner, Config, Job, User } from '../../api/client'
import { routes } from '../../routes'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfig: vi.fn(),
  getMe: vi.fn(),
  getJob: vi.fn(),
  approveJob: vi.fn(),
  getWallet: vi.fn(),
  listBanners: vi.fn(),
}))

const config: Config = {
  provider: 'mock', max_audio_seconds: 60, max_script_chars: 100, max_image_mb: 1, languages: ['English'],
  credits_per_second: 20, voice_price_credits: 10, payments: 'mock', razorpay_key_id: null,
  min_purchase_credits: 1000, max_purchase_credits: 10000, payment_fee_bps: 200, payment_fee_gst_bps: 0,
  support_email: null, consent_version: 'v', consent_text: 'ok', daily_video_limit: 50, banners_enabled: true,
}
const job = (extra: Partial<Job> = {}): Job => ({
  id: 'job-1', status: 'audio_ready', language: 'English', script: 'Hello', audio_duration_seconds: 4.2,
  price_credits: 240, charged_credits: 10, voice_credits: 10, video_credits: 0, failure_kind: null,
  voice_reusable: false, video_expired: false, needs_review: false, consent_at: null, script_id: null,
  voice_from_job_id: null, start_template: null, end_template: null, banners_applied: null,
  audio_url: 'https://example.test/a.mp3', video_url: null, error: null,
  created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z', ...extra,
})
const banner = (id: string, name: string): Banner => ({ id, name, image_url: `/img/${id}`, created_at: '2026-11-10T10:00:00Z' })
const approve = () => screen.getByRole('button', { name: 'Approve and make video' }) as HTMLButtonElement

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
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
  vi.mocked(getJob).mockResolvedValue(job())
  vi.mocked(listBanners).mockResolvedValue({ items: [banner('b1', 'Logo'), banner('b2', 'Sale')] })
})

describe('Review: choose a banner (D-067)', () => {
  it('R-85: shows the section with the customer banners, none preselected, and a Manage banners link', async () => {
    renderAt('/create/job-1')
    expect(await screen.findByRole('heading', { name: 'Choose a banner' })).toBeTruthy()
    const logo = (await screen.findByRole('radio', { name: /Logo/ })) as HTMLInputElement
    expect(logo.checked).toBe(false)
    expect((screen.getByRole('radio', { name: /Sale/ }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('link', { name: 'Manage banners' }).getAttribute('href')).toBe('/banners')
  })

  it('R-85: no banner section and no banner request when banners are not enabled; approve works as before', async () => {
    vi.mocked(getConfig).mockResolvedValue({ ...config, banners_enabled: false })
    vi.mocked(approveJob).mockResolvedValue(job({ status: 'video_submitting' }))
    const user = renderAt('/create/job-1')
    await screen.findByRole('button', { name: 'Approve and make video' })
    expect(screen.queryByRole('heading', { name: 'Choose a banner' })).toBeNull()
    expect(screen.queryByText('Choose a banner to continue.')).toBeNull()
    expect(listBanners).not.toHaveBeenCalled()
    await user.click(approve())
    expect(approveJob).toHaveBeenCalledWith('job-1', undefined)
  })

  it('R-85: approve stays disabled with a hint until a banner is chosen, then sends its id', async () => {
    vi.mocked(approveJob).mockResolvedValue(job({ status: 'video_submitting' }))
    const user = renderAt('/create/job-1')
    await screen.findByRole('radio', { name: /Sale/ })
    expect(approve().disabled).toBe(true)
    expect(screen.getByText('Choose a banner to continue.')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: /Sale/ }))
    expect(approve().disabled).toBe(false)
    expect(screen.queryByText('Choose a banner to continue.')).toBeNull()
    await user.click(approve())
    expect(approveJob).toHaveBeenCalledTimes(1)
    expect(approveJob).toHaveBeenCalledWith('job-1', 'b2')
  })

  it('R-85: an empty library shows the notice with a link to /banners and keeps approve disabled', async () => {
    vi.mocked(listBanners).mockResolvedValue({ items: [] })
    renderAt('/create/job-1')
    expect(await screen.findByText(/You have no banners yet\. Upload one to make this video\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Upload a banner' }).getAttribute('href')).toBe('/banners')
    expect(approve().disabled).toBe(true)
  })

  it('R-85: a 422 on banner_id shows the message, refetches banners and clears the choice', async () => {
    vi.mocked(approveJob).mockRejectedValue(new ApiError(422, 'Invalid', 'validation_error', { banner_id: 'Choose one of your banners.' }))
    const user = renderAt('/create/job-1')
    await user.click(await screen.findByRole('radio', { name: /Logo/ }))
    await user.click(approve())
    expect(await screen.findByText('Choose one of your banners.')).toBeTruthy()
    await vi.waitFor(() => expect(listBanners).toHaveBeenCalledTimes(2))
    expect((screen.getByRole('radio', { name: /Logo/ }) as HTMLInputElement).checked).toBe(false)
    expect(approve().disabled).toBe(true)
  })

  it('R-85: a 404 banner_not_found shows the message, refetches banners and clears the choice', async () => {
    vi.mocked(approveJob).mockRejectedValue(new ApiError(404, 'That banner was deleted.', 'banner_not_found'))
    const user = renderAt('/create/job-1')
    await user.click(await screen.findByRole('radio', { name: /Logo/ }))
    await user.click(approve())
    expect(await screen.findByText('That banner was deleted.')).toBeTruthy()
    await vi.waitFor(() => expect(listBanners).toHaveBeenCalledTimes(2))
    expect((screen.getByRole('radio', { name: /Logo/ }) as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByText('We could not start your video')).toBeNull()
  })

  it('a double tap on approve sends one request', async () => {
    let resolve!: (j: Job) => void
    vi.mocked(approveJob).mockReturnValue(new Promise<Job>((r) => (resolve = r)))
    const user = renderAt('/create/job-1')
    await user.click(await screen.findByRole('radio', { name: /Logo/ }))
    // Two taps in the same tick, before React re-renders with the pending state.
    fireEvent.click(approve())
    fireEvent.click(approve())
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Starting your video…' })).toBeTruthy())
    expect(approveJob).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Starting your video…' }))
    expect(approveJob).toHaveBeenCalledTimes(1)
    resolve(job({ status: 'video_submitting' }))
  })

  it('after a failed approve, approving again sends a new request', async () => {
    vi.mocked(approveJob).mockRejectedValueOnce(new ApiError(500, 'The server had a problem.', 'server_error'))
    vi.mocked(approveJob).mockResolvedValueOnce(job({ status: 'video_submitting' }))
    const user = renderAt('/create/job-1')
    await user.click(await screen.findByRole('radio', { name: /Logo/ }))
    await user.click(approve())
    expect(await screen.findByText('The server had a problem.')).toBeTruthy()
    await user.click(approve())
    expect(approveJob).toHaveBeenCalledTimes(2)
  })
})
