import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createJob, getWallet } from '../../api/client'
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
  max_script_chars: 100,
  max_image_mb: 1,
  languages: ['English'],
  credits_per_second: 20, voice_price_credits: 10,
  payments: 'mock', razorpay_key_id: null, min_purchase_credits: 1000, max_purchase_credits: 10000,
  payment_fee_bps: 200, payment_fee_gst_bps: 0, support_email: null,
  consent_version: '2026-11-17', consent_text: 'Wording from the server.', daily_video_limit: 50,
}

const job = { id: 'job-1', status: 'audio_generating' } as Job

function renderForm(client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <JobForm config={config} onCreated={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const box = () => screen.getByRole('checkbox', { name: 'Wording from the server.' }) as HTMLInputElement
const submit = () => screen.getByRole('button', { name: /^Make my voice/ }) as HTMLButtonElement
const scriptBox = () => screen.getByLabelText(/what should the person say/i) as HTMLTextAreaElement

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText(/upload a photo/i), new File([new Uint8Array(10)], 'f.jpg', { type: 'image/jpeg' }))
  await user.type(scriptBox(), 'Hello')
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getWallet).mockResolvedValue({ available_credits: 500, reserved_credits: 0, balance_credits: 500 })
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})

describe('Create consent (R-14)', () => {
  it('R-14: not ticked by default, wording from config, button off with the hint', () => {
    renderForm()
    expect(box().checked).toBe(false)
    expect(screen.getByText('Permission to use this photo')).toBeTruthy()
    expect(screen.getByText('Required. We keep a record of this agreement with your video.')).toBeTruthy()
    expect(submit().disabled).toBe(true)
    expect(screen.getByText('Tick the box above to continue.')).toBeTruthy()
  })

  it('R-14: ticking enables the button and submit sends consent and the config version', async () => {
    vi.mocked(createJob).mockResolvedValue(job)
    const user = renderForm()
    await fill(user)
    await user.click(box())
    expect(submit().disabled).toBe(false)
    expect(screen.queryByText('Tick the box above to continue.')).toBeNull()
    await user.click(submit())
    expect(vi.mocked(createJob).mock.calls[0][4]).toEqual({ consent: true, version: '2026-11-17' })
  })

  it('R-14: the cost box shows the configured price and the server balance, no balance-after', async () => {
    renderForm()
    expect(screen.getByText('Voice (10 credits)')).toBeTruthy()
    expect(screen.getByText('Taken now')).toBeTruthy()
    expect(await screen.findByText('500 credits')).toBeTruthy()
    expect(screen.queryByText('Balance after')).toBeNull()
    expect(screen.getByText(/If we cannot make the voice, the 10 credits are returned/)).toBeTruthy()
  })

  it('R-14: a 422 consent_required shows the server text under the box and keeps the input', async () => {
    vi.mocked(createJob).mockRejectedValue(new ApiError(422, 'x', 'consent_required', { consent: 'Please confirm you have permission.' }))
    const user = renderForm()
    await fill(user)
    await user.click(box())
    await user.click(submit())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Please confirm you have permission.')
    expect(box().getAttribute('aria-describedby')).toContain(alert.id)
    expect(scriptBox().value).toBe('Hello')
    expect(box().checked).toBe(true)
  })

  it('R-14: consent_outdated shows the server text and refetches the config', async () => {
    vi.mocked(createJob).mockRejectedValue(new ApiError(422, 'x', 'consent_outdated', { consent: 'The wording changed.' }))
    const client = new QueryClient()
    const refetch = vi.spyOn(client, 'refetchQueries')
    const user = renderForm(client)
    await fill(user)
    await user.click(box())
    await user.click(submit())
    expect((await screen.findByRole('alert')).textContent).toBe('The wording changed.')
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['config'] })
  })
})
