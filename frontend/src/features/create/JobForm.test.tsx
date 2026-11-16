import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createJob } from '../../api/client'
import type { Config, Job } from '../../api/client'
import { JobForm } from './JobForm'

vi.mock('../../api/client', () => ({
  createJob: vi.fn(),
}))

const config: Config = {
  provider: 'mock',
  max_audio_seconds: 60,
  max_script_chars: 10,
  max_image_mb: 1,
  languages: ['English', 'Hindi'],
  video_price_per_second_usd: 0.1,
}

const job: Job = {
  id: 'job-1',
  status: 'audio_generating',
  language: 'Hindi',
  script: 'Hello',
  audio_duration_seconds: null,
  estimated_video_cost_usd: null,
  audio_url: null,
  video_url: null,
  error: null,
  created_at: '2026-11-17T00:00:00Z',
  updated_at: '2026-11-17T00:00:00Z',
}

function photo(size = 10): File {
  return new File([new Uint8Array(size)], 'face.jpg', { type: 'image/jpeg' })
}

function renderForm(onCreated = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <JobForm config={config} onCreated={onCreated} />
    </QueryClientProvider>,
  )
  return { onCreated, user: userEvent.setup() }
}

describe('JobForm validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('R-08: shows "Please choose a photo." and does not call createJob when no photo is chosen', async () => {
    const { onCreated, user } = renderForm()
    await user.type(screen.getByLabelText(/^script/i), 'Hello')
    await user.click(screen.getByRole('button', { name: 'Generate voice' }))

    expect(screen.getByRole('alert').textContent).toBe('Please choose a photo.')
    expect(createJob).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('R-08: shows the size limit message and does not call createJob when the photo is larger than max_image_mb', async () => {
    const { onCreated, user } = renderForm()
    await user.upload(screen.getByLabelText(/photo/i), photo(1024 * 1024 + 1))
    await user.type(screen.getByLabelText(/^script/i), 'Hello')
    await user.click(screen.getByRole('button', { name: 'Generate voice' }))

    expect(screen.getByRole('alert').textContent).toBe('Image must be 1 MB or smaller.')
    expect(createJob).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('R-08: shows "Please enter a script." and does not call createJob when the script is empty', async () => {
    const { onCreated, user } = renderForm()
    await user.upload(screen.getByLabelText(/photo/i), photo())
    await user.click(screen.getByRole('button', { name: 'Generate voice' }))

    expect(screen.getByRole('alert').textContent).toBe('Please enter a script.')
    expect(createJob).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('R-08: shows "Please enter a script." and does not call createJob when the script is only whitespace', async () => {
    const { onCreated, user } = renderForm()
    await user.upload(screen.getByLabelText(/photo/i), photo())
    await user.type(screen.getByLabelText(/^script/i), '     ')
    await user.click(screen.getByRole('button', { name: 'Generate voice' }))

    expect(screen.getByRole('alert').textContent).toBe('Please enter a script.')
    expect(createJob).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('R-08: shows the length limit message and does not call createJob when the script is longer than max_script_chars', async () => {
    const { onCreated, user } = renderForm()
    await user.upload(screen.getByLabelText(/photo/i), photo())
    await user.type(screen.getByLabelText(/^script/i), 'a'.repeat(11))
    await user.click(screen.getByRole('button', { name: 'Generate voice' }))

    expect(screen.getByRole('alert').textContent).toBe('Script must be 10 characters or fewer.')
    expect(createJob).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('R-08: calls createJob once with the photo, the trimmed script and the language, then reports the created job', async () => {
    vi.mocked(createJob).mockResolvedValue(job)
    const { onCreated, user } = renderForm()
    const file = photo()
    await user.upload(screen.getByLabelText(/photo/i), file)
    await user.type(screen.getByLabelText(/^script/i), '  Hello  ')
    await user.selectOptions(screen.getByLabelText(/language/i), 'Hindi')
    await user.click(screen.getByRole('button', { name: 'Generate voice' }))

    expect(createJob).toHaveBeenCalledTimes(1)
    expect(createJob).toHaveBeenCalledWith(file, 'Hello', 'Hindi')
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(job))
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('R-08: shows the character counter as "<length> / <max>"', async () => {
    const { user } = renderForm()
    expect(screen.getByText('0 / 10')).toBeTruthy()
    await user.type(screen.getByLabelText(/^script/i), 'Hello')
    expect(screen.getByText('5 / 10')).toBeTruthy()
  })
})
