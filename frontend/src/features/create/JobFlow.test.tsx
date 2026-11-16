import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, approveJob, getConfig, getJob, NetworkError } from '../../api/client'
import type { Config, Job } from '../../api/client'
import { routes } from '../../routes'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfig: vi.fn(),
  getJob: vi.fn(),
  approveJob: vi.fn(),
  createJob: vi.fn(),
}))

const KEY = 'talking-avatar-job-id'

const config: Config = {
  provider: 'mock',
  max_audio_seconds: 60,
  max_script_chars: 100,
  max_image_mb: 1,
  languages: ['English'],
  video_price_per_second_usd: 0.1,
}

const baseJob: Job = {
  id: 'job-1',
  status: 'audio_generating',
  language: 'English',
  script: 'Hello',
  audio_duration_seconds: 4.2,
  estimated_video_cost_usd: 0.42,
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
})

afterEach(() => {
  vi.useRealTimers()
})

describe('job screens by status', () => {
  it('R-08: audio_generating shows "Generating voice…"', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_generating'))
    renderAt('/create/job-1')
    expect(await screen.findByText(/Generating voice…/)).toBeTruthy()
  })

  it('R-08: audio_ready shows the audio review with the approve and start over buttons', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready'))
    renderAt('/create/job-1')
    expect(await screen.findByText('Review the audio')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve audio and generate video' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy()
  })

  it('R-08: video_submitting shows "Generating video…"', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('video_submitting'))
    renderAt('/create/job-1')
    expect(await screen.findByText(/Generating video…/)).toBeTruthy()
  })

  it('R-08: video_generating shows "Generating video…"', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('video_generating'))
    renderAt('/create/job-1')
    expect(await screen.findByText(/Generating video…/)).toBeTruthy()
  })

  it('R-08: completed shows the video, a download link and "Create another"', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('completed', { video_url: 'https://example.test/v.mp4' }))
    renderAt('/create/job-1')
    expect(await screen.findByText('Your video')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download video' }).getAttribute('href')).toBe('https://example.test/v.mp4')
    expect(screen.getByRole('button', { name: 'Create another' })).toBeTruthy()
  })

  it('R-08: failed shows "Generation failed" with the error and "Start over"', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('failed', { error: 'Provider said no' }))
    renderAt('/create/job-1')
    expect(await screen.findByText('Generation failed')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Provider said no')
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
    expect(screen.getByText('Your video')).toBeTruthy()
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
    expect(screen.getByText(/Generating video…/)).toBeTruthy()
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
    await tick(3000)
    expect(getConfig).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Generate voice' })).toBeTruthy()
    await tick(10000)
    expect(getConfig).toHaveBeenCalledTimes(2)
  })
})

describe('approve', () => {
  it('R-08: approve success updates the job on screen and sends one request', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready'))
    vi.mocked(approveJob).mockResolvedValue(withStatus('video_submitting'))
    const { user } = renderAt('/create/job-1')
    await user.click(await screen.findByRole('button', { name: 'Approve audio and generate video' }))
    expect(await screen.findByText(/Generating video…/)).toBeTruthy()
    expect(approveJob).toHaveBeenCalledTimes(1)
    expect(approveJob).toHaveBeenCalledWith('job-1')
  })

  it('R-08: approve cannot be submitted twice while the request is in flight', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready'))
    let resolve!: (j: Job) => void
    vi.mocked(approveJob).mockReturnValue(new Promise<Job>((r) => (resolve = r)))
    const { user } = renderAt('/create/job-1')
    const button = await screen.findByRole('button', { name: 'Approve audio and generate video' })
    await user.click(button)
    const busy = await screen.findByRole('button', { name: 'Submitting…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    await user.click(busy)
    expect(approveJob).toHaveBeenCalledTimes(1)
    await act(async () => resolve(withStatus('video_submitting')))
    expect(await screen.findByText(/Generating video…/)).toBeTruthy()
  })

  it('R-08: approve failure shows the error and refetches the job', async () => {
    vi.mocked(getJob)
      .mockResolvedValueOnce(withStatus('audio_ready'))
      .mockResolvedValue(withStatus('video_generating'))
    vi.mocked(approveJob).mockRejectedValue(new ApiError(409, 'Job is not ready to approve', 'conflict'))
    const { user } = renderAt('/create/job-1')
    await user.click(await screen.findByRole('button', { name: 'Approve audio and generate video' }))
    await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Generating video…/)).toBeTruthy()
  })

  it('R-08: approve failure shows the error message when the job is still ready', async () => {
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready'))
    vi.mocked(approveJob).mockRejectedValue(new ApiError(409, 'Job is not ready to approve', 'conflict'))
    const { user } = renderAt('/create/job-1')
    await user.click(await screen.findByRole('button', { name: 'Approve audio and generate video' }))
    const alert = await screen.findByText('Job is not ready to approve')
    expect(alert.getAttribute('role')).toBe('alert')
    await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Job is not ready to approve')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Approve audio and generate video' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('returning visitors', () => {
  it('R-55: opening /create with a stored id redirects to /create/<id>', async () => {
    localStorage.setItem(KEY, 'job-9')
    vi.mocked(getJob).mockResolvedValue(withStatus('audio_ready', { id: 'job-9' }))
    renderAt('/create')
    expect(await screen.findByText('Review the audio')).toBeTruthy()
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
    expect(await screen.findByText('Review the audio')).toBeTruthy()
    expect(getJob).toHaveBeenCalledWith('shared-id')
  })
})
