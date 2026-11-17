import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createJob, getWallet, NetworkError } from '../../api/client'
import type { Config, Job } from '../../api/client'
import { JobForm } from './JobForm'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  createJob: vi.fn(),
  getWallet: vi.fn(),
}))

const config: Config = {
  provider: 'mock',
  max_audio_seconds: 60,
  max_script_chars: 10,
  max_image_mb: 1,
  languages: ['English', 'Hindi'],
  credits_per_second: 20, voice_price_credits: 10,
  payments: 'mock', razorpay_key_id: null, min_purchase_credits: 1000, max_purchase_credits: 10000,
  payment_fee_bps: 200, payment_fee_gst_bps: 0, support_email: null,
  consent_version: '2026-11-17', consent_text: 'I have permission.', daily_video_limit: 50,
}

const job: Job = {
  id: 'job-1',
  status: 'audio_generating',
  language: 'Hindi',
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
}

function photo(size = 10): File {
  return new File([new Uint8Array(size)], 'face.jpg', { type: 'image/jpeg' })
}

function renderForm(onCreated = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <JobForm config={config} onCreated={onCreated} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onCreated, user: userEvent.setup() }
}

const photoInput = () => screen.getByLabelText(/upload a photo/i)
const scriptBox = () => screen.getByLabelText(/what should the person say/i)
const submit = () => screen.getByRole('button', { name: 'Generate voice' })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getWallet).mockResolvedValue({ available_credits: 500, reserved_credits: 0, balance_credits: 500 })
  // jsdom has no object URLs; the drop zone previews the chosen photo with one.
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})

describe('JobForm fields', () => {
  it('R-79: every field has a visible label and a hint with its limits', () => {
    renderForm()
    expect(photoInput()).toBeTruthy()
    expect(screen.getByText('JPEG, PNG or WebP, up to 1 MB.')).toBeTruthy()
    expect(screen.getByLabelText('Language')).toBeTruthy()
    expect(screen.getByText(/Up to 10 characters/)).toBeTruthy()
  })

  it('R-79: shows the character counter as "<length> / <max>"', async () => {
    const { user } = renderForm()
    expect(screen.getByText('0 / 10')).toBeTruthy()
    await user.type(scriptBox(), 'Hello')
    expect(screen.getByText('5 / 10')).toBeTruthy()
  })

  it('R-79: choosing a photo shows its preview', async () => {
    const { user } = renderForm()
    await user.upload(photoInput(), photo())
    expect(screen.getByAltText('Preview of face.jpg')).toBeTruthy()
  })
})

describe('JobForm client validation', () => {
  it('R-79: validates the script when it loses focus, not while typing the first attempt', async () => {
    const { user } = renderForm()
    await user.click(scriptBox())
    expect(screen.queryByRole('alert')).toBeNull()
    await user.tab()
    expect(screen.getByRole('alert').textContent).toBe('Please enter a script.')
  })

  it('R-79: after a first error the script is validated live and the message clears', async () => {
    const { user } = renderForm()
    await user.click(scriptBox())
    await user.tab()
    expect(screen.getByRole('alert')).toBeTruthy()
    await user.type(scriptBox(), 'Hi')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.type(scriptBox(), 'x'.repeat(10))
    expect(screen.getByRole('alert').textContent).toContain('too long')
  })

  it('R-79: submitting with no photo and no script shows both messages and focuses the first invalid field', async () => {
    const { onCreated, user } = renderForm()
    await user.click(submit())
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent)
    expect(alerts).toEqual(['Please choose a photo.', 'Please enter a script.'])
    expect(document.activeElement).toBe(photoInput())
    expect(createJob).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('R-79: with a photo but no script, focus moves to the script', async () => {
    const { user } = renderForm()
    await user.upload(photoInput(), photo())
    await user.click(submit())
    expect(screen.getByRole('alert').textContent).toBe('Please enter a script.')
    expect(document.activeElement).toBe(scriptBox())
    expect(createJob).not.toHaveBeenCalled()
  })

  it('R-79: a whitespace-only script is rejected', async () => {
    const { user } = renderForm()
    await user.upload(photoInput(), photo())
    await user.type(scriptBox(), '     ')
    await user.click(submit())
    expect(screen.getByRole('alert').textContent).toBe('Please enter a script.')
    expect(createJob).not.toHaveBeenCalled()
  })

  it('R-79: a script over the limit says by how many characters and is not sent', async () => {
    const { user } = renderForm()
    await user.upload(photoInput(), photo())
    await user.type(scriptBox(), 'a'.repeat(12))
    await user.click(submit())
    expect(screen.getByRole('alert').textContent).toBe('Your script is 2 characters too long. Shorten it to continue.')
    expect(createJob).not.toHaveBeenCalled()
  })

  it('R-79: a photo over the size limit is rejected when chosen, before any upload', async () => {
    const { user } = renderForm()
    await user.upload(photoInput(), photo(1024 * 1024 + 1))
    expect(screen.getByRole('alert').textContent).toContain('Choose one up to 1 MB')
    expect(createJob).not.toHaveBeenCalled()
  })
})

describe('JobForm submit', () => {
  it('R-08: calls createJob once with the photo, the trimmed script and the language, then reports the created job', async () => {
    vi.mocked(createJob).mockResolvedValue(job)
    const { onCreated, user } = renderForm()
    const file = photo()
    await user.upload(photoInput(), file)
    await user.type(scriptBox(), '  Hello  ')
    await user.selectOptions(screen.getByLabelText('Language'), 'Hindi')
    await user.click(submit())
    expect(createJob).toHaveBeenCalledTimes(1)
    expect(createJob).toHaveBeenCalledWith(file, 'Hello', 'Hindi')
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(job))
  })

  it('R-80: the button is busy while the request runs and cannot be submitted twice', async () => {
    let resolve!: (j: Job) => void
    vi.mocked(createJob).mockReturnValue(new Promise<Job>((r) => (resolve = r)))
    const { onCreated, user } = renderForm()
    await user.upload(photoInput(), photo())
    await user.type(scriptBox(), 'Hello')
    await user.click(submit())
    const busy = await screen.findByRole('button', { name: 'Generating voice…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    await user.click(busy)
    await user.keyboard('{Enter}')
    expect(createJob).toHaveBeenCalledTimes(1)
    await act(async () => resolve(job))
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('R-79: a server 422 with fields.script shows under the script field and keeps what was typed', async () => {
    vi.mocked(createJob).mockRejectedValue(
      new ApiError(422, 'Invalid input', 'validation_error', { script: 'This script is written in Hindi.' }),
    )
    const { user } = renderForm()
    const file = photo()
    await user.upload(photoInput(), file)
    await user.type(scriptBox(), 'Hello')
    await user.selectOptions(screen.getByLabelText('Language'), 'Hindi')
    await user.click(submit())
    const alert = await screen.findByText('This script is written in Hindi.')
    expect(scriptBox().getAttribute('aria-describedby')).toContain(alert.closest('p')?.id)
    expect(document.activeElement).toBe(scriptBox())
    expect((scriptBox() as HTMLTextAreaElement).value).toBe('Hello')
    expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('Hindi')
    expect(screen.getByAltText('Preview of face.jpg')).toBeTruthy()
    expect(screen.queryByText('We could not generate the voice')).toBeNull()
  })

  it('R-79: server fields.image and fields.language show under their fields', async () => {
    vi.mocked(createJob).mockRejectedValue(
      new ApiError(422, 'Invalid input', 'validation_error', { image: 'Not a real image.', language: 'Unsupported language.' }),
    )
    const { user } = renderForm()
    await user.upload(photoInput(), photo())
    await user.type(scriptBox(), 'Hello')
    await user.click(submit())
    expect(await screen.findByText('Not a real image.')).toBeTruthy()
    expect(screen.getByText('Unsupported language.')).toBeTruthy()
  })

  it('R-80: an error with no field is shown as a banner above the button and nothing is lost', async () => {
    vi.mocked(createJob).mockRejectedValue(new ApiError(500, 'The voice service is down', 'provider_error'))
    const { user } = renderForm()
    await user.upload(photoInput(), photo())
    await user.type(scriptBox(), 'Hello')
    await user.click(submit())
    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain('The voice service is down')
    expect((scriptBox() as HTMLTextAreaElement).value).toBe('Hello')
    expect((submit() as HTMLButtonElement).getAttribute('aria-busy')).toBeNull()
  })

  it('R-80: a network failure is explained in a banner', async () => {
    vi.mocked(createJob).mockRejectedValue(new NetworkError('Network error'))
    const { user } = renderForm()
    await user.upload(photoInput(), photo())
    await user.type(scriptBox(), 'Hello')
    await user.click(submit())
    expect((await screen.findByRole('alert')).textContent).toContain('Check your connection')
  })
})
