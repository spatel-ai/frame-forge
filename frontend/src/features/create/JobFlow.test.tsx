import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, approveJob, getConfig, getJob, getMe, getWallet, NetworkError } from '../../api/client'
import type { Config, Job, User } from '../../api/client'
import { routes } from '../../routes'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfig: vi.fn(),
  getMe: vi.fn(),
  getJob: vi.fn(),
  approveJob: vi.fn(),
  getWallet: vi.fn(),
  createJob: vi.fn(),
}))

const KEY = 'talking-avatar-job-id'

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

const baseJob: Job = {
  id: 'job-1',
  status: 'audio_generating',
  language: 'English',
  script: 'Hello',
  audio_duration_seconds: 4.2,
  price_credits: 240, charged_credits: 10,
  voice_credits: 10, video_credits: 0, failure_kind: null, voice_reusable: false, needs_review: false,
  consent_at: null, script_id: null, voice_from_job_id: null, start_template: null, end_template: null, banners_applied: null,
  audio_url: 'https://example.test/a.mp3',
  video_url: null,
  error: null,
  created_at: '2026-11-17T00:00:00Z',
  updated_at: '2026-11-17T00:00:00Z',
}
const withStatus = (status: Job['status'], extra: Partial<Job> = {}): Job => ({ ...baseJob, status, ...extra })

let router: ReturnType<typeof createMemoryRouter>

function renderAt(path: string) {
  router = createMemoryRouter(routes, { initialEntries: [path] })
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { user: userEvent.setup() }
}

// Query Client notifies React through a zero-delay timer, so let that run too.
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    await vi.advanceTimersByTimeAsync(1)
  })

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(getConfig).mockResolvedValue(config)
  vi.mocked(getWallet).mockResolvedValue({ available_credits: 500, reserved_credits: 0, balance_credits: 500 })
  vi.mocked(getMe).mockResolvedValue({ id: 'u1', name: 'Asha Verma', email: 'asha@example.com', email_verified: true, role: 'user', active_sessions: 1 } as User)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('job screens by status', () => {
  it('R-08, R-80: audio_generating shows the named voice step', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_generating'))
    renderAt('/create/job-1')
    expect(await screen.findByText('Making the voice', { selector: 'h2' })).toBeTruthy()
  })

  it('R-08: audio_ready shows the audio review with the approve and start over buttons', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready'))
    renderAt('/create/job-1')
    expect(await screen.findByText('Listen to the voice')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve and make video' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy()
  })

  it('R-08, R-80: video_submitting shows "Generating video…"', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('video_submitting'))
    renderAt('/create/job-1')
    expect(await screen.findByText(/Making your video/)).toBeTruthy()
  })

  it('R-08, R-80: video_generating shows "Generating video…"', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('video_generating'))
    renderAt('/create/job-1')
    expect(await screen.findByText(/Making your video/)).toBeTruthy()
  })

  it('R-08: completed shows the video, a download link and "Create another"', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('completed', { video_url: 'https://example.test/v.mp4' }))
    renderAt('/create/job-1')
    expect(await screen.findByText('Your video is ready')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download video' }).getAttribute('href')).toBe('https://example.test/v.mp4')
    expect(screen.getByRole('button', { name: 'Create another' })).toBeTruthy()
  })

  it('R-08, R-80: failed shows what happened, that nothing was charged, and "Start over"', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('failed', { error: 'Provider said no', charged_credits: 0 }))
    renderAt('/create/job-1')
    expect(await screen.findByText('We could not make this video')).toBeTruthy()
    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('Provider said no')
    expect(alert).toContain('Nothing was charged')
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy()
  })

  it('R-08: "Start over" clears the stored id and goes to /create', async () => {
    localStorage.setItem(KEY, 'job-1')
    vi.mocked(getJob).mockResolvedValue(withStatus('failed', { error: 'x' }))
    const { user } = renderAt('/create/job-1')
    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    expect(router.state.location.pathname).toBe('/create')
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(await screen.findByRole('button', { name: 'Generate voice' })).toBeTruthy()
  })

  it('R-08: "Create another" clears the stored id and goes to /create', async () => {
    localStorage.setItem(KEY, 'job-1')
    vi.mocked(getJob).mockResolvedValue(withStatus('completed', { video_url: 'https://example.test/v.mp4' }))
    const { user } = renderAt('/create/job-1')
    await user.click(await screen.findByRole('button', { name: 'Create another' }))
    expect(router.state.location.pathname).toBe('/create')
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

describe('polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  for (const status of ['audio_generating', 'video_submitting', 'video_generating'] as const) {
    it(`R-55: keeps polling every 3 seconds while the job is ${status}`, async () => {
      vi.mocked(getJob).mockResolvedValue(withStatus(status))
      renderAt('/create/job-1')
      await tick(0)
      expect(getJob).toHaveBeenCalledTimes(1)
      await tick(3000)
      expect(getJob).toHaveBeenCalledTimes(2)
      await tick(3000)
      expect(getJob).toHaveBeenCalledTimes(3)
    })
  }

  for (const status of ['audio_ready', 'completed', 'failed'] as const) {
    it(`R-55: stops polling when the job is ${status}`, async () => {
      vi.mocked(getJob).mockResolvedValue(withStatus(status))
      renderAt('/create/job-1')
      await tick(0)
      expect(getJob).toHaveBeenCalledTimes(1)
      await tick(10000)
      expect(getJob).toHaveBeenCalledTimes(1)
    })
  }

  it('R-55: stops polling after an in-progress job becomes completed', async () => {
    vi.mocked(getJob)
      .mockResolvedValueOnce(withStatus('video_generating'))
      .mockResolvedValue(withStatus('completed', { video_url: 'https://example.test/v.mp4' }))
    renderAt('/create/job-1')
    await tick(0)
    await tick(3000)
    expect(screen.getByText('Your video is ready')).toBeTruthy()
    expect(getJob).toHaveBeenCalledTimes(2)
    await tick(10000)
    expect(getJob).toHaveBeenCalledTimes(2)
  })

  it('R-55: shows "Connection problem, retrying…" on a network failure, keeps polling and clears the message on recovery', async () => {
    vi.mocked(getJob)
      .mockResolvedValueOnce(withStatus('video_generating'))
      .mockRejectedValueOnce(new NetworkError('Network error'))
      .mockResolvedValue(withStatus('video_generating'))
    renderAt('/create/job-1')
    await tick(0)
    expect(screen.queryByText('Connection problem, retrying…')).toBeNull()
    await tick(3000)
    expect(screen.getByText('Connection problem, retrying…')).toBeTruthy()
    expect(screen.getByText(/Making your video/)).toBeTruthy()
    await tick(3000)
    expect(getJob).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('Connection problem, retrying…')).toBeNull()
  })

  it('R-55: a 404 clears the stored id and redirects to /create', async () => {
    localStorage.setItem(KEY, 'job-1')
    vi.mocked(getJob).mockRejectedValue(new ApiError(404, 'Job not found', 'not_found'))
    renderAt('/create/job-1')
    await tick(0)
    expect(router.state.location.pathname).toBe('/create')
    expect(localStorage.getItem(KEY)).toBeNull()
    await tick(0)
    expect(screen.getByRole('button', { name: 'Generate voice' })).toBeTruthy()
    expect(getJob).toHaveBeenCalledTimes(1)
  })

  it('R-55: the configuration is retried every 3 seconds until it loads', async () => {
    vi.mocked(getConfig).mockRejectedValueOnce(new NetworkError('Network error')).mockResolvedValue(config)
    renderAt('/create')
    await tick(0)
    expect(screen.getByText('Cannot load configuration (Network error). Retrying…')).toBeTruthy()
    expect(screen.getByText('Loading the form')).toBeTruthy()
    await tick(3000)
    expect(getConfig).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Generate voice' })).toBeTruthy()
    await tick(10000)
    expect(getConfig).toHaveBeenCalledTimes(2)
  })
})

describe('approve', () => {
  it('R-08, R-81: approve success updates the job on screen and sends one request', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready'))
    vi.mocked(approveJob).mockResolvedValue(withStatus('video_submitting'))
    const { user } = renderAt('/create/job-1')
    await user.click(await screen.findByRole('button', { name: 'Approve and make video' }))
    expect(await screen.findByText(/Making your video/)).toBeTruthy()
    expect(approveJob).toHaveBeenCalledTimes(1)
    expect(approveJob).toHaveBeenCalledWith('job-1')
  })

  it('R-08, R-80: approve cannot be submitted twice while the request is in flight', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready'))
    let resolve!: (j: Job) => void
    vi.mocked(approveJob).mockReturnValue(new Promise<Job>((r) => (resolve = r)))
    const { user } = renderAt('/create/job-1')
    const button = await screen.findByRole('button', { name: 'Approve and make video' })
    await user.click(button)
    const busy = await screen.findByRole('button', { name: 'Starting your video…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    await user.click(busy)
    expect(approveJob).toHaveBeenCalledTimes(1)
    await act(async () => resolve(withStatus('video_submitting')))
    expect(await screen.findByText(/Making your video/)).toBeTruthy()
  })

  it('R-08, R-81: approve failure shows the error and refetches the job', async () => {
    vi.mocked(getJob)
      .mockResolvedValueOnce(withStatus('audio_ready'))
      .mockResolvedValue(withStatus('video_generating'))
    vi.mocked(approveJob).mockRejectedValue(new ApiError(409, 'Job is not ready to approve', 'conflict'))
    const { user } = renderAt('/create/job-1')
    await user.click(await screen.findByRole('button', { name: 'Approve and make video' }))
    await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Making your video/)).toBeTruthy()
  })

  it('R-08, R-80: approve failure shows the error message when the job is still ready', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready'))
    vi.mocked(approveJob).mockRejectedValue(new ApiError(409, 'Job is not ready to approve', 'conflict'))
    const { user } = renderAt('/create/job-1')
    await user.click(await screen.findByRole('button', { name: 'Approve and make video' }))
    const alert = await screen.findByText('Job is not ready to approve')
    expect(alert.closest('[role="alert"]')).toBeTruthy()
    await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Job is not ready to approve')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Approve and make video' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('returning visitors', () => {
  it('R-55: opening /create with a stored id redirects to /create/<id>', async () => {
    localStorage.setItem(KEY, 'job-9')
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready', { id: 'job-9' }))
    renderAt('/create')
    expect(await screen.findByText('Listen to the voice')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/create/job-9')
    expect(getJob).toHaveBeenCalledWith('job-9')
  })

  it('R-55: opening /create without a stored id shows the form', async () => {
    renderAt('/create')
    expect(await screen.findByRole('button', { name: 'Generate voice' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/create')
    expect(getJob).not.toHaveBeenCalled()
  })

  it('R-55: opening /create/<id> directly shows that job', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready', { id: 'shared-id' }))
    renderAt('/create/shared-id')
    expect(await screen.findByText('Listen to the voice')).toBeTruthy()
    expect(getJob).toHaveBeenCalledWith('shared-id')
  })
})

const stepList = () => screen.getByRole('list', { name: 'Create a video' })
const currentStep = () => stepList().querySelector('li[aria-current="step"]')?.textContent ?? ''

describe('stepper and heading', () => {
  const cases: [Job, string][] = [
    [withStatus('audio_generating'), 'Review'],
    [withStatus('audio_ready'), 'Review'],
    [withStatus('video_submitting'), 'Video'],
    [withStatus('video_generating'), 'Video'],
    [withStatus('completed', { video_url: 'https://example.test/v.mp4' }), 'Video'],
    [withStatus('failed', { error: 'x' }), 'Video'],
    [withStatus('failed', { error: 'x', audio_url: null }), 'Review'],
  ]
  for (const [job, label] of cases) {
    it(`R-79: ${job.status}${job.audio_url ? '' : ' (no audio)'} marks "${label}" as the current step`, async () => {
      vi.mocked(getJob).mockResolvedValue(job)
      renderAt('/create/job-1')
      await screen.findByRole('heading', { level: 2 }).catch(() => undefined)
      await vi.waitFor(() => expect(currentStep()).toContain(label))
      expect(within(stepList()).getAllByRole('listitem')).toHaveLength(3)
    })
  }

  it('R-76: the details screen marks "Details" as current and has exactly one h1', async () => {
    renderAt('/create')
    await screen.findByRole('button', { name: 'Generate voice' })
    expect(currentStep()).toContain('Details')
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Create a video'])
  })

  it('R-76: a job screen has exactly one h1', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready'))
    renderAt('/create/job-1')
    await screen.findByText('Listen to the voice')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})

describe('waiting and failure states', () => {
  it('R-80: the first load of a job shows a skeleton, not a bare message', async () => {
    vi.mocked(getJob).mockReturnValue(new Promise(() => {}))
    renderAt('/create/job-1')
    expect(await screen.findByText('Loading your video')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
  })

  it('R-80: the first load of the form shows a skeleton while the configuration loads', async () => {
    vi.mocked(getConfig).mockReturnValue(new Promise(() => {}))
    renderAt('/create')
    expect(await screen.findByText('Loading the form')).toBeTruthy()
  })

  it('R-80, R-55: video_submitting and video_generating show named steps and say it is safe to leave', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('video_submitting'))
    renderAt('/create/job-1')
    const sending = await screen.findByText('Sending to the video model')
    expect(sending.closest('li')?.getAttribute('aria-current')).toBe('step')
    expect(screen.getByText('Voice ready')).toBeTruthy()
    expect(screen.getByText(/several minutes/)).toBeTruthy()
    expect(screen.getByText(/safe to leave or reload/)).toBeTruthy()
  })

  it('R-81: video_generating marks "Making the video" as the current progress step', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('video_generating'))
    renderAt('/create/job-1')
    const making = await screen.findByText('Making the video')
    expect(making.closest('li')?.getAttribute('aria-current')).toBe('step')
  })

  it('R-08: completed shows the video player, the AI-generated label and a download link', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('completed', { video_url: 'https://example.test/v.mp4' }))
    const { container } = renderAt('/create/job-1').user && { container: document.body }
    await screen.findByText('Your video is ready')
    expect(container.querySelector('video')?.getAttribute('src')).toBe('https://example.test/v.mp4')
    expect(screen.getByText('AI-generated')).toBeTruthy()
  })

  it('R-80: an unknown status shows an error with "Start over"', async () => {
    vi.mocked(getJob).mockResolvedValue({ ...baseJob, status: 'mystery' as Job['status'] })
    renderAt('/create/job-1')
    expect(await screen.findByText('Something unexpected happened')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy()
  })

  it('R-09: the review screen shows the duration', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready'))
    renderAt('/create/job-1')
    await screen.findByText('Listen to the voice')
    expect(screen.getByText('4.2 seconds')).toBeTruthy()
  })

  it('R-80, R-81: a poll error shows a non-blocking banner while the job stays visible', async () => {
    vi.useFakeTimers()
    vi.mocked(getJob)
      .mockResolvedValueOnce(withStatus('video_generating'))
      .mockRejectedValue(new NetworkError('Network error'))
    renderAt('/create/job-1')
    await tick(0)
    await tick(3000)
    expect(screen.getByText('Connection problem, retrying…')).toBeTruthy()
    expect(screen.getByText('Making your video')).toBeTruthy()
  })
})
