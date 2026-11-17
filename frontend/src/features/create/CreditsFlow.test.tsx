import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, approveJob, listBanners, createJob, getConfig, getJob, getMe, getWallet } from '../../api/client'
import type { Config, Job, User, Wallet } from '../../api/client'
import { routes } from '../../routes'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfig: vi.fn(),
  getMe: vi.fn(),
  getJob: vi.fn(),
  getWallet: vi.fn(),
  approveJob: vi.fn(),
  listBanners: vi.fn(),
  createJob: vi.fn(),
}))

const config: Config = {
  provider: 'mock', max_audio_seconds: 60, max_script_chars: 100, max_image_mb: 1,
  languages: ['English'], credits_per_second: 20, voice_price_credits: 10,
  payments: 'mock', razorpay_key_id: null, min_purchase_credits: 1000, max_purchase_credits: 10000,
  payment_fee_bps: 200, payment_fee_gst_bps: 0, support_email: null,
  consent_version: '2026-11-17', consent_text: 'I have permission.', daily_video_limit: 50, banners_enabled: true,
}
const wallet = (available: number): Wallet => ({ available_credits: available, reserved_credits: 0, balance_credits: available })
const baseJob: Job = {
  id: 'job-1', status: 'audio_ready', language: 'English', script: 'Hello', audio_duration_seconds: 12,
  price_credits: 240, charged_credits: 10,
  voice_credits: 10, video_credits: 0, failure_kind: null, voice_reusable: false, video_expired: false, needs_review: false,
  consent_at: null, script_id: null, voice_from_job_id: null, start_template: null, end_template: null, banners_applied: null, audio_url: 'https://example.test/a.mp3', video_url: null, error: null,
  created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z',
}
const job = (extra: Partial<Job>): Job => ({ ...baseJob, ...extra })

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { user: userEvent.setup() }
}

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    await vi.advanceTimersByTimeAsync(1)
  })

// Screens mounting one after another each ask for the wallet; wait until that has gone quiet.
async function settledWalletCalls() {
  let last = -1
  await vi.waitFor(() => {
    const now = vi.mocked(getWallet).mock.calls.length
    const stable = now === last && now > 0
    last = now
    if (!stable) throw new Error('wallet still loading')
  })
  return vi.mocked(getWallet).mock.calls.length
}

const approveButton = () => screen.getByRole('button', { name: 'Approve and make video' }) as HTMLButtonElement
const generateButton = () => screen.getByRole('button', { name: /^Make my voice/ }) as HTMLButtonElement

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(await screen.findByLabelText(/upload a photo/i), new File([new Uint8Array(10)], 'f.jpg', { type: 'image/jpeg' }))
  await user.type(screen.getByLabelText(/what should the person say/i), 'Hello')
  await user.click(screen.getByRole('checkbox', { name: 'I have permission.' }))
  await user.click(generateButton())
}

const banner = { id: 'b1', name: 'Logo', image_url: '/api/v1/banners/b1/image', created_at: '2026-11-10T10:00:00Z' }
const chooseBanner = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('radio', { name: /Logo/ }))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(listBanners).mockResolvedValue({ items: [banner] })
  localStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  vi.mocked(getConfig).mockResolvedValue(config)
  vi.mocked(getWallet).mockResolvedValue(wallet(500))
  vi.mocked(getMe).mockResolvedValue({ id: 'u1', name: 'Asha', email: 'a@example.com', email_verified: true, role: 'user', active_sessions: 1 } as User)
})
afterEach(() => vi.useRealTimers())

describe('details screen prices', () => {
  it('R-09 shows the voice price from the config', async () => {
    vi.mocked(getConfig).mockResolvedValue({ ...config, voice_price_credits: 12345 })
    renderAt('/create')
    expect(await screen.findByText('Generating the voice costs 12,345 credits.')).toBeTruthy()
  })

  it('R-09 R-13 disables Generate and shows the banner when available is below the voice price', async () => {
    vi.mocked(getWallet).mockResolvedValue(wallet(4))
    renderAt('/create')
    expect(await screen.findByText('You have 4 credits; generating a voice costs 10.')).toBeTruthy()
    expect(generateButton().disabled).toBe(true)
    expect(screen.getByRole('link', { name: 'View wallet' }).getAttribute('href')).toBe('/wallet')
  })

  it('R-09 keeps Generate enabled when available equals the voice price', async () => {
    vi.mocked(getWallet).mockResolvedValue(wallet(10))
    renderAt('/create')
    await screen.findByText(/Generating the voice costs/)
    await vi.waitFor(() => expect(getWallet).toHaveBeenCalled())
    expect(screen.queryByText('Not enough credits')).toBeNull()
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'I have permission.' }))
    expect(generateButton().disabled).toBe(false)
  })

  it('R-09 R-13 a 402 on create shows the server detail and refetches the wallet', async () => {
    vi.mocked(createJob).mockRejectedValue(new ApiError(402, 'Server says: you have 10 credits, need 10 more.', 'insufficient_credits'))
    const { user } = renderAt('/create')
    const base = await settledWalletCalls()
    await fillAndSubmit(user)
    expect(await screen.findByText('Server says: you have 10 credits, need 10 more.')).toBeTruthy()
    expect(screen.getByText('Not enough credits')).toBeTruthy()
    expect(screen.queryByText('We could not generate the voice')).toBeNull()
    await vi.waitFor(() => expect(vi.mocked(getWallet).mock.calls.length).toBeGreaterThan(base))
  })

  it('R-13 invalidates the wallet after a successful create', async () => {
    vi.mocked(createJob).mockResolvedValue(job({ status: 'audio_generating', price_credits: null }))
    vi.mocked(getJob).mockResolvedValue(job({ status: 'audio_generating', price_credits: null }))
    const { user } = renderAt('/create')
    const base = await settledWalletCalls()
    await fillAndSubmit(user)
    await vi.waitFor(() => expect(vi.mocked(getWallet).mock.calls.length).toBeGreaterThan(base))
  })
})

describe('review price card', () => {
  it('R-09 R-13 shows the server price and balance, with no balance-after row', async () => {
    vi.mocked(getJob).mockResolvedValue(job({ price_credits: 1234567 }))
    vi.mocked(getWallet).mockResolvedValue(wallet(2000000))
    renderAt('/create/job-1')
    expect(await screen.findByText('12,34,567 credits')).toBeTruthy()
    expect(await screen.findAllByText('20,00,000 credits')).toBeTruthy()
    expect(screen.getByText('Video price')).toBeTruthy()
    expect(screen.getByText('Available')).toBeTruthy()
    expect(screen.queryByText(/balance after/i)).toBeNull()
    expect(screen.getByText(/Credits are reserved now and only taken when your video is ready/)).toBeTruthy()
    await userEvent.click(await screen.findByRole('radio', { name: /Logo/ }))
    expect(approveButton().disabled).toBe(false)
  })

  it('R-09 R-13 disables Approve and shows the banner when available is below the price', async () => {
    vi.mocked(getJob).mockResolvedValue(job({ price_credits: 240 }))
    vi.mocked(getWallet).mockResolvedValue(wallet(100))
    renderAt('/create/job-1')
    expect(await screen.findByText('This video costs 240 credits. You have 100.')).toBeTruthy()
    expect(approveButton().disabled).toBe(true)
    expect(screen.getByRole('link', { name: 'Add credits' }).getAttribute('href')).toBe('/wallet?buy=1&return=%2Fcreate%2Fjob-1')
  })

  it('R-09 a null price shows "Price not available yet" and keeps Approve disabled', async () => {
    vi.mocked(getJob).mockResolvedValue(job({ price_credits: null }))
    renderAt('/create/job-1')
    expect(await screen.findByText('Price not available yet')).toBeTruthy()
    expect(approveButton().disabled).toBe(true)
  })

  it('R-09 R-13 a 402 on approve shows the server detail and refetches the wallet', async () => {
    vi.mocked(getJob).mockResolvedValue(job({ price_credits: 240 }))
    vi.mocked(approveJob).mockRejectedValue(new ApiError(402, 'Need 240 credits, you have 230.', 'insufficient_credits'))
    const { user } = renderAt('/create/job-1')
    await screen.findByText('240 credits')
    const base = await settledWalletCalls()
    await chooseBanner(user)
    await user.click(approveButton())
    expect(await screen.findByText('Need 240 credits, you have 230.')).toBeTruthy()
    expect(screen.queryByText('We could not start your video')).toBeNull()
    await vi.waitFor(() => expect(vi.mocked(getWallet).mock.calls.length).toBeGreaterThan(base))
  })

  it('R-13 invalidates the wallet after a successful approve', async () => {
    vi.mocked(getJob).mockResolvedValue(job({}))
    vi.mocked(approveJob).mockResolvedValue(job({ status: 'video_submitting' }))
    const { user } = renderAt('/create/job-1')
    await screen.findByText('240 credits')
    const base = await settledWalletCalls()
    await chooseBanner(user)
    await user.click(approveButton())
    await vi.waitFor(() => expect(vi.mocked(getWallet).mock.calls.length).toBeGreaterThan(base))
  })
})

describe('wallet follows the job', () => {
  beforeEach(() => vi.useFakeTimers())

  for (const finish of ['completed', 'failed'] as const) {
    it(`R-13 refetches the wallet once when the job becomes ${finish}, not on every poll`, async () => {
      vi.mocked(getJob)
        .mockResolvedValueOnce(job({ status: 'video_generating' }))
        .mockResolvedValueOnce(job({ status: 'video_generating' }))
        .mockResolvedValue(job({ status: finish, video_url: 'https://example.test/v.mp4' }))
      renderAt('/create/job-1')
      await tick(0)
      await tick(0)
      const base = vi.mocked(getWallet).mock.calls.length
      await tick(3000)
      expect(getJob).toHaveBeenCalledTimes(2)
      expect(getWallet).toHaveBeenCalledTimes(base)
      await tick(3000)
      expect(getJob).toHaveBeenCalledTimes(3)
      expect(getWallet).toHaveBeenCalledTimes(base + 1)
      await tick(10000)
      expect(getWallet).toHaveBeenCalledTimes(base + 1)
    })
  }

  it('R-13 does not refetch the wallet for a job that is already completed on first load', async () => {
    vi.mocked(getJob).mockResolvedValue(job({ status: 'completed', video_url: 'https://example.test/v.mp4' }))
    renderAt('/create/job-1')
    await tick(0)
    await tick(0)
    const base = vi.mocked(getWallet).mock.calls.length
    await tick(5000)
    expect(getWallet).toHaveBeenCalledTimes(base)
  })
})

describe('charged amounts', () => {
  it('R-13 the result screen shows what was charged, as the server sent it', async () => {
    vi.mocked(getJob).mockResolvedValue(job({ status: 'completed', video_url: 'https://example.test/v.mp4', charged_credits: 250 }))
    renderAt('/create/job-1')
    expect(await screen.findByText('Charged: 250 credits')).toBeTruthy()
  })

  it('R-13 the failed screen says "Nothing was charged" only when charged_credits is 0', async () => {
    vi.mocked(getJob).mockResolvedValue(job({ status: 'failed', error: 'x', charged_credits: 0 }))
    renderAt('/create/job-1')
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was charged')
  })

  it('R-13 the failed screen shows the charge, not "Nothing was charged", when something was charged', async () => {
    vi.mocked(getJob).mockResolvedValue(job({ status: 'failed', error: 'x', charged_credits: 10 }))
    renderAt('/create/job-1')
    const text = (await screen.findByRole('alert')).textContent ?? ''
    expect(text).toContain('Charged: 10 credits')
    expect(text).not.toContain('Nothing was charged')
  })
})
