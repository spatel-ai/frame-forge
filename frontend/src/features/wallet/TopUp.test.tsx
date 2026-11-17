import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createOrder, listBanners, getConfig, getJob, getMe, getOrder, getQuote, getTransactions, getWallet, mockCompletePayment, verifyPayment,
} from '../../api/client'
import type { Config, Job, PaymentOrder, User, Wallet } from '../../api/client'
import { safeReturnPath, topUpPath } from '../../lib/returnPath'
import { routes } from '../../routes'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  listBanners: vi.fn(), getConfig: vi.fn(), getMe: vi.fn(), getWallet: vi.fn(), getTransactions: vi.fn(), getJob: vi.fn(),
  getQuote: vi.fn(), createOrder: vi.fn(), getOrder: vi.fn(), verifyPayment: vi.fn(), mockCompletePayment: vi.fn(),
}))
vi.mock('../../lib/checkout', () => ({ openCheckout: vi.fn(), loadCheckout: vi.fn() }))

const me = { id: 'u1', name: 'Asha Verma', email: 'asha@example.com', email_verified: true, role: 'user', active_sessions: 1 } as User
const config = {
  provider: 'mock', payments: 'mock', razorpay_key_id: null, payment_fee_bps: 200, payment_fee_gst_bps: 0,
  min_purchase_credits: 1000, max_purchase_credits: 10000, max_audio_seconds: 60, max_script_chars: 100,
  max_image_mb: 1, languages: ['English'], credits_per_second: 20, voice_price_credits: 10, support_email: null,
  consent_version: '2026-11-17', consent_text: 'I have permission.', daily_video_limit: 50, banners_enabled: true,
} as Config
const wallet = (available: number): Wallet => ({ available_credits: available, reserved_credits: 0, balance_credits: available })
const job = {
  id: 'job-1', status: 'audio_ready', language: 'English', script: 'Hello', audio_duration_seconds: 30,
  price_credits: 600, charged_credits: 10,
  voice_credits: 10, video_credits: 0, failure_kind: null, voice_reusable: false, needs_review: false,
  consent_at: null, script_id: null, voice_from_job_id: null, start_template: null, end_template: null, banners_applied: null, audio_url: 'https://example.test/a.mp3', video_url: null, error: null,
  created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z',
} as Job
const order: PaymentOrder = {
  order_id: 'o1', razorpay_order_id: 'order_rz1', amount_paise: 102000, price_paise: 100000, fee_paise: 2000, fee_gst_paise: 0,
  credits: 1000, key_id: 'rzp_test_key', status: 'created',
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const approveButton = () => screen.getByRole('button', { name: 'Approve and make video' }) as HTMLButtonElement

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getConfig).mockResolvedValue(config)
  vi.mocked(listBanners).mockResolvedValue({ items: [{ id: 'b1', name: 'Logo', image_url: '/i', created_at: '2026-11-10T10:00:00Z' }] })
  vi.mocked(getMe).mockResolvedValue(me)
  vi.mocked(getWallet).mockResolvedValue(wallet(290))
  vi.mocked(getTransactions).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 })
  vi.mocked(getJob).mockResolvedValue(job)
  vi.mocked(getQuote).mockImplementation(async (c) => ({ credits: c, price_paise: c * 100, fee_paise: c * 2, fee_gst_paise: 0, amount_paise: c * 102 }))
  vi.mocked(createOrder).mockResolvedValue(order)
  vi.mocked(mockCompletePayment).mockResolvedValue({ razorpay_order_id: 'order_rz1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' })
  vi.mocked(verifyPayment).mockResolvedValue({ order_id: 'o1', status: 'paid', credits: 1000, wallet: wallet(1290) })
  vi.mocked(getOrder).mockResolvedValue({ order_id: 'o1', status: 'paid', credits: 1000, created_at: '2026-11-17T08:00:00Z' })
})

describe('safe return path (D-061)', () => {
  it.each(['/create/abc', '/create/abc-123_X'])('R-47 accepts %s', (v) => {
    expect(safeReturnPath(v)).toBe(v)
  })
  it.each([
    'https://evil.example', '//evil.example', '/wallet', '/create/abc/../x', '/create/abc?x=1', '/create/', '/create/a/b',
    '/create/%2e%2e', '/create/abc#x', '/create/abc\n', 'create/abc', '', '\\evil.example', '/create/abc%0d',
  ])('R-47 rejects %j', (v) => {
    expect(safeReturnPath(v)).toBeNull()
  })
  it('R-47 builds the top-up address with the job page encoded', () => {
    expect(topUpPath('job-1')).toBe('/wallet?buy=1&return=%2Fcreate%2Fjob-1')
  })
})

describe('top-up loop (D-061)', () => {
  it('R-47 short on credits: Add credits opens the wallet dialog at the minimum; success returns to the video with Approve enabled', async () => {
    renderAt('/create/job-1')
    const add = await screen.findByRole('link', { name: 'Add credits' })
    expect(screen.getByText("After paying you'll come back to this video.")).toBeTruthy()
    expect(approveButton().disabled).toBe(true)
    await userEvent.click(add)

    const d = within(await screen.findByRole('dialog'))
    expect((d.getByLabelText('Credits to buy') as HTMLInputElement).value).toBe('1000')
    expect(d.getByText("After paying you'll come back to this video.")).toBeTruthy()
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    vi.mocked(getWallet).mockResolvedValue(wallet(1290)) // what the server will now report
    await userEvent.click(await d.findByRole('button', { name: 'Pay' }))
    expect(
      await d.findByText((_, el) => el?.tagName === 'P' && /1,000 credits were added to your wallet\. Your balance is now 1,290 credits\. You can approve your video\./.test(el.textContent ?? '')),
    ).toBeTruthy()
    expect(d.getByText((_, el) => el?.tagName === 'DT' && el.textContent === 'You paid (₹1,000 plus ₹20 payment fee)')).toBeTruthy()
    expect(d.queryByRole('button', { name: 'Done' })).toBeNull()
    await userEvent.click(d.getByRole('button', { name: 'Back to your video' }))

    await userEvent.click(await screen.findByRole('radio', { name: /Logo/ }))
    await waitFor(() => expect(approveButton().disabled).toBe(false))
    expect(screen.queryByText('Not enough credits')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('R-47 without a return path the success state keeps Done', async () => {
    renderAt('/wallet?buy=1')
    const d = within(await screen.findByRole('dialog'))
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await userEvent.click(await d.findByRole('button', { name: 'Pay' }))
    expect(await d.findByRole('button', { name: 'Done' })).toBeTruthy()
    expect(d.queryByRole('button', { name: 'Back to your video' })).toBeNull()
    expect(d.queryByText(/You can approve your video/)).toBeNull()
  })

  it.each(['https://evil.example', '//evil.example', '/wallet', '/create/abc/../x', '/create/abc?x=1'])(
    'R-47 ignores the unsafe return value %s: the dialog behaves as without a return',
    async (value) => {
      const router = renderAt(`/wallet?buy=1&return=${encodeURIComponent(value)}`)
      const d = within(await screen.findByRole('dialog'))
      expect(d.queryByText("After paying you'll come back to this video.")).toBeNull()
      await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
      await userEvent.click(await d.findByRole('button', { name: 'Pay' }))
      expect(await d.findByRole('button', { name: 'Done' })).toBeTruthy()
      expect(d.queryByRole('button', { name: 'Back to your video' })).toBeNull()
      await userEvent.click(d.getByRole('button', { name: 'Done' }))
      expect(router.state.location.pathname).toBe('/wallet')
      expect(screen.queryByRole('link', { name: 'Back to your video' })).toBeNull()
    },
  )

  it('R-47 a return value without buy=1 does nothing', async () => {
    renderAt('/wallet?return=%2Fcreate%2Fjob-1')
    await screen.findByRole('heading', { name: 'Wallet' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Back to your video' })).toBeNull()
  })

  it('R-47 a failed payment still offers Try again, and the customer can still go back to the video', async () => {
    const router = renderAt('/wallet?buy=1&return=%2Fcreate%2Fjob-1')
    const d = within(await screen.findByRole('dialog'))
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await userEvent.click(await d.findByRole('button', { name: 'Fail' }))
    expect(await d.findByText(/No credits were added/)).toBeTruthy()
    expect(d.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(d.getByRole('link', { name: 'Back to your video' }).getAttribute('href')).toBe('/create/job-1')
    await userEvent.click(d.getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement)
    // After Close the wallet page itself keeps the way back.
    await userEvent.click(await screen.findByRole('link', { name: 'Back to your video' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/create/job-1'))
  })

  it('R-47 a cancelled payment still offers Try again and the way back', async () => {
    renderAt('/wallet?buy=1&return=%2Fcreate%2Fjob-1')
    const d = within(await screen.findByRole('dialog'))
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await userEvent.click(await d.findByRole('button', { name: 'Cancel' }))
    expect(await d.findByRole('heading', { name: 'Payment cancelled' })).toBeTruthy()
    expect(d.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(d.getByRole('link', { name: 'Back to your video' })).toBeTruthy()
  })
})
