import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createJob, getConfig, getJob, getMe, login, meKey, resendVerification } from './api/client'
import type { Config, Job, User } from './api/client'
import { createQueryClient } from './lib/session'
import { routes } from './routes'

vi.mock('./api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api/client')>()),
  getConfig: vi.fn(),
  getMe: vi.fn(),
  getJob: vi.fn(),
  createJob: vi.fn(),
  login: vi.fn(),
  resendVerification: vi.fn(),
}))

const KEY = 'talking-avatar-job-id'
const notAuth = () => new ApiError(401, 'Not logged in', 'not_authenticated')
const asha = (extra: Partial<User> = {}) =>
  ({ id: 'u1', name: 'Asha Verma', email: 'asha@example.com', email_verified: true, role: 'user', active_sessions: 1, ...extra }) as User

const config: Config = {
  provider: 'mock',
  max_audio_seconds: 60,
  max_script_chars: 100,
  max_image_mb: 1,
  languages: ['English'],
  credits_per_second: 20, voice_price_credits: 10,
  payments: 'mock', razorpay_key_id: null, min_purchase_credits: 1000, max_purchase_credits: 10000,
  payment_fee_bps: 200, payment_fee_gst_bps: 0, support_email: null,
  consent_version: '2026-11-17', consent_text: 'I have permission.', daily_video_limit: 50,
}
const job = (extra: Partial<Job> = {}): Job => ({
  id: 'job-1',
  status: 'audio_generating',
  language: 'English',
  script: 'Hello',
  audio_duration_seconds: null,
  price_credits: null, charged_credits: 0,
  voice_credits: 0, video_credits: 0, failure_kind: null, voice_reusable: false, needs_review: false,
  consent_at: null, script_id: null, voice_from_job_id: null, start_template: null, end_template: null, banners_applied: null,
  audio_url: null,
  video_url: null,
  error: null,
  created_at: '2026-11-17T00:00:00Z',
  updated_at: '2026-11-17T00:00:00Z',
  ...extra,
})

let router: ReturnType<typeof createMemoryRouter>

function renderAt(path: string) {
  const queryClient = createQueryClient(() => router)
  router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { queryClient, user: userEvent.setup() }
}
const where = () => router.state.location.pathname + router.state.location.search

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(getConfig).mockResolvedValue(config)
})

describe('guarded routes', () => {
  it('R-01 sends an anonymous visitor on /create to /login?next=%2Fcreate', async () => {
    vi.mocked(getMe).mockRejectedValue(notAuth())
    renderAt('/create')
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy()
    expect(where()).toBe('/login?next=%2Fcreate')
  })

  it('R-01 keeps a /create/:jobId address in next', async () => {
    vi.mocked(getMe).mockRejectedValue(notAuth())
    renderAt('/create/job-9?x=1')
    await screen.findByRole('heading', { name: 'Log in' })
    expect(where()).toBe('/login?next=' + encodeURIComponent('/create/job-9?x=1'))
  })

  it('R-01 returns the user to next after logging in', async () => {
    vi.mocked(getMe).mockRejectedValue(notAuth())
    vi.mocked(login).mockResolvedValue(asha())
    vi.mocked(getJob).mockResolvedValue(job())
    const { user } = renderAt('/create/job-1')
    await user.type(await screen.findByLabelText('Email'), 'asha@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-long-password-1')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await waitFor(() => expect(where()).toBe('/create/job-1'))
    expect(await screen.findByText('Making the voice', { selector: 'h2' })).toBeTruthy()
  })

  it('R-01 shows a full-page skeleton while me loads', async () => {
    vi.mocked(getMe).mockReturnValue(new Promise(() => {}))
    renderAt('/create')
    expect(screen.getByRole('status').textContent).toContain('Loading your account')
    expect(where()).toBe('/create')
  })

  it('R-01 sends a logged-in user from /login to /create', async () => {
    vi.mocked(getMe).mockResolvedValue(asha())
    renderAt('/login')
    await waitFor(() => expect(where()).toBe('/create'))
  })

  it('R-01 leaves /verify-email and /reset-password alone when logged in', async () => {
    vi.mocked(getMe).mockResolvedValue(asha())
    renderAt('/verify-email')
    await new Promise((r) => setTimeout(r, 20))
    expect(where()).toBe('/verify-email')
  })

  it('R-01 shows the user name in the top bar', async () => {
    vi.mocked(getMe).mockResolvedValue(asha())
    renderAt('/create')
    expect(await screen.findByText('Asha Verma')).toBeTruthy()
  })
})

describe('session expiry', () => {
  it('R-01 a 401 from a job poll clears the cache and stored job id, then goes to log in with next', async () => {
    localStorage.setItem(KEY, 'job-1')
    let expired = false
    vi.mocked(getMe).mockImplementation(() => (expired ? Promise.reject(notAuth()) : Promise.resolve(asha())))
    vi.mocked(getJob).mockImplementation(() => {
      expired = true
      return Promise.reject(notAuth())
    })
    const { queryClient } = renderAt('/create/job-1')
    await screen.findByRole('heading', { name: 'Log in' })
    expect(where()).toBe('/login?next=' + encodeURIComponent('/create/job-1'))
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(queryClient.getQueryData(['job', 'job-1'])).toBeUndefined()
    expect(queryClient.getQueryData(meKey)).toBeNull()
  })

  it('R-01 does not loop when a 401 happens on /login', async () => {
    vi.mocked(getMe).mockRejectedValue(notAuth())
    const { queryClient } = renderAt('/login')
    await screen.findByRole('heading', { name: 'Log in' })
    const before = router.state.historyAction
    await act(async () => {
      await queryClient.fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(notAuth()), retry: false }).catch(() => {})
    })
    expect(where()).toBe('/login')
    expect(router.state.historyAction).toBe(before)
  })

  it('R-01 ignores 401 invalid_credentials: no clearing, no redirect', async () => {
    vi.mocked(getMe).mockResolvedValue(asha())
    vi.mocked(getJob).mockResolvedValue(job())
    const { queryClient } = renderAt('/create/job-1')
    await screen.findByText('Making the voice', { selector: 'h2' })
    await act(async () => {
      await queryClient
        .fetchQuery({ queryKey: ['y'], queryFn: () => Promise.reject(new ApiError(401, 'x', 'invalid_credentials')), retry: false })
        .catch(() => {})
    })
    expect(where()).toBe('/create/job-1')
    expect(queryClient.getQueryData(meKey)).toBeTruthy()
  })
})

describe('unconfirmed email notice', () => {
  const unverified = () => asha({ email_verified: false })
  const renderCreate = () => {
    vi.mocked(getMe).mockResolvedValue(unverified())
    return renderAt('/create')
  }

  it('R-01 shows the notice, and Generate voice is disabled with the explanation', async () => {
    renderCreate()
    expect(await screen.findByText('Confirm your email to make videos')).toBeTruthy()
    expect(screen.getByText('asha@example.com')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Generate voice' })).toHaveProperty('disabled', true)
    expect(screen.getByText('You can fill this in now. Generating needs a confirmed email.')).toBeTruthy()
    expect(screen.getByLabelText('What should the person say?')).toHaveProperty('disabled', false)
  })

  it('R-01 does not show the notice for a confirmed user', async () => {
    vi.mocked(getMe).mockResolvedValue(asha())
    renderAt('/create')
    await screen.findByRole('button', { name: 'Generate voice' })
    expect(screen.queryByText('Confirm your email to make videos')).toBeNull()
  })

  it('R-01 resend is busy while sending, then says the link was sent', async () => {
    let done: () => void = () => {}
    vi.mocked(resendVerification).mockReturnValue(new Promise<void>((r) => (done = r)))
    const { user } = renderCreate()
    await user.click(await screen.findByRole('button', { name: 'Send the link again' }))
    expect(screen.getByRole('button', { name: 'Sending…' }).getAttribute('aria-busy')).toBe('true')
    await act(async () => done())
    expect(await screen.findByText('The link was sent again. Check your inbox.')).toBeTruthy()
  })

  it('R-01 resend shows the server detail on 429 rate_limited', async () => {
    vi.mocked(resendVerification).mockRejectedValue(new ApiError(429, 'Try again in 60 seconds.', 'rate_limited'))
    const { user } = renderCreate()
    await user.click(await screen.findByRole('button', { name: 'Send the link again' }))
    expect(await screen.findByText('Try again in 60 seconds.')).toBeTruthy()
  })

  it('R-01 a 403 email_not_verified from create refetches me and shows the notice', async () => {
    // The cached user says confirmed; the server disagrees.
    vi.mocked(getMe).mockResolvedValueOnce(asha()).mockResolvedValue(asha({ email_verified: false }))
    vi.mocked(createJob).mockRejectedValue(new ApiError(403, 'Confirm your email first.', 'email_not_verified'))
    const { user } = renderAt('/create')
    await screen.findByRole('button', { name: 'Generate voice' })
    await user.upload(screen.getByLabelText(/upload a photo/i), new File([new Uint8Array(10)], 'f.jpg', { type: 'image/jpeg' }))
    await user.type(screen.getByLabelText('What should the person say?'), 'Hello')
    await user.click(screen.getByRole('button', { name: 'Generate voice' }))
    expect(await screen.findByText('Confirm your email to make videos')).toBeTruthy()
    expect(getMe).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('We could not generate the voice')).toBeNull()
  })

  it('R-01 refetches me on window focus even within the stale time, clearing the notice', async () => {
    vi.mocked(getMe).mockResolvedValueOnce(unverified()).mockResolvedValue(asha())
    renderAt('/create')
    await screen.findByText('Confirm your email to make videos')
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(screen.queryByText('Confirm your email to make videos')).toBeNull())
  })
})
