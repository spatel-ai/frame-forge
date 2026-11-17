import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  createOrder,
  getConfig,
  getMe,
  getOrder,
  getQuote,
  getTransactions,
  getWallet,
  mockCompletePayment,
  verifyPayment,
} from '../../api/client'
import type { Config, PaymentOrder, PaymentQuote, PaymentVerified, User, Wallet } from '../../api/client'
import { openCheckout } from '../../lib/checkout'
import type { OpenCheckoutArgs } from '../../lib/checkout'
import { routes } from '../../routes'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfig: vi.fn(),
  getMe: vi.fn(),
  getWallet: vi.fn(),
  getTransactions: vi.fn(),
  createOrder: vi.fn(),
  getOrder: vi.fn(),
  getQuote: vi.fn(),
  verifyPayment: vi.fn(),
  mockCompletePayment: vi.fn(),
}))
// The real Checkout script is never loaded in tests.
vi.mock('../../lib/checkout', () => ({ openCheckout: vi.fn(), loadCheckout: vi.fn() }))

const me = { id: 'u1', name: 'Asha Verma', email: 'asha@example.com', email_verified: true, role: 'user', active_sessions: 1 } as User
const config = (payments: 'mock' | 'razorpay'): Config =>
  ({
    provider: 'mock', payments, razorpay_key_id: payments === 'mock' ? null : 'rzp_test_key',
    payment_fee_bps: 200, payment_fee_gst_bps: 0, min_purchase_credits: 1000, max_purchase_credits: 10000, max_audio_seconds: 60, max_script_chars: 100,
    max_image_mb: 1, languages: ['English'], credits_per_second: 20,
  }) as Config
// What the server would answer at a 2% fee (test data only; the app never computes this).
const quote = (credits: number): PaymentQuote => ({
  credits, price_paise: credits * 100, fee_paise: credits * 2, fee_gst_paise: 0, amount_paise: credits * 102,
})
const wallet = (available: number): Wallet => ({ available_credits: available, reserved_credits: 0, balance_credits: available })
const order = (credits: number): PaymentOrder => ({
  order_id: 'o1', razorpay_order_id: 'order_rz1', amount_paise: credits * 102, price_paise: credits * 100, fee_paise: credits * 2, fee_gst_paise: 0, credits, key_id: 'rzp_test_key', status: 'created',
})
const verified = (credits: number, balance: number): PaymentVerified => ({
  order_id: 'o1', status: 'paid', credits, wallet: wallet(balance),
})
const proof = { razorpay_order_id: 'order_rz1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' }
/** Matches a paragraph by its whole text; amounts inside it sit in their own no-wrap spans. */
const paragraph = (text: string) => (_: string, el: Element | null) => el?.tagName === 'P' && el.textContent === text
const notCaptured = () => new ApiError(409, 'Not captured yet.', 'payment_not_captured')

function renderWallet(payments: 'mock' | 'razorpay' = 'mock') {
  vi.mocked(getConfig).mockResolvedValue(config(payments))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: ['/wallet'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

async function openDialog(user: { click: (el: Element) => Promise<void> } = userEvent) {
  await user.click(await screen.findByRole('button', { name: 'Buy credits' }))
  return screen.findByRole('dialog')
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getMe).mockResolvedValue(me)
  vi.mocked(getWallet).mockResolvedValue(wallet(1000))
  vi.mocked(getQuote).mockImplementation(async (c) => quote(c))
  vi.mocked(getTransactions).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 })
})
afterEach(() => vi.useRealTimers())

describe('buy-credits form', () => {
  it('R-02 R-47 prefills the minimum and shows price, payment fee, total and balance after from the server quote', async () => {
    renderWallet()
    const dialog = await openDialog()
    const d = within(dialog)
    expect((d.getByLabelText('Credits to buy') as HTMLInputElement).value).toBe('1000')
    expect(d.getByRole('button', { name: '1,000 credits' }).getAttribute('aria-pressed')).toBe('true')
    expect(d.getByText('Whole credits, from 1,000 to 10,000 credits.')).toBeTruthy()
    expect(await d.findByRole('button', { name: 'Pay ₹1,020' })).toBeTruthy()
    expect(getQuote).toHaveBeenCalledWith(1000)
    const row = (label: string) => d.getByText(label).closest('div') as HTMLElement
    expect(within(row('Price')).getByText('₹1,000')).toBeTruthy()
    expect(within(row('Payment fee')).getByText('₹20')).toBeTruthy()
    expect(within(row('You pay')).getByText('₹1,020')).toBeTruthy()
    expect(within(row('Balance after')).getByText('2,000 credits')).toBeTruthy() // 1,000 held + 1,000 bought
    expect(d.queryByText('GST on the fee')).toBeNull() // only when the server says there is some
    await userEvent.click(d.getByRole('button', { name: '2,500 credits' }))
    expect(await d.findByRole('button', { name: 'Pay ₹2,550' })).toBeTruthy()
    expect(within(row('Payment fee')).getByText('₹50')).toBeTruthy()
    expect(d.getByText('3,500 credits')).toBeTruthy()
  })

  it('R-47 offers no quick amount below the minimum from config', async () => {
    renderWallet()
    const d = within(await openDialog())
    expect(d.queryByRole('button', { name: '500 credits' })).toBeNull()
    expect(d.getAllByRole('button', { name: /^[\d,]+ credits$/ }).map((b) => b.textContent)).toEqual([
      '1,000 credits', '2,500 credits', '5,000 credits', '10,000 credits',
    ])
  })

  it('R-47 shows GST on the fee as its own line when the quote has some, and paise only when non-zero', async () => {
    vi.mocked(getQuote).mockResolvedValue({ credits: 1000, price_paise: 100000, fee_paise: 2000, fee_gst_paise: 360, amount_paise: 102360 })
    renderWallet()
    const d = within(await openDialog())
    expect(await d.findByRole('button', { name: 'Pay ₹1,023.60' })).toBeTruthy()
    expect(within(d.getByText('GST on the fee').closest('div') as HTMLElement).getByText('₹3.60')).toBeTruthy()
  })

  it('R-47 refreshes the quote when the amount changes and keeps Pay disabled until the new quote arrives', async () => {
    renderWallet()
    const d = within(await openDialog())
    await d.findByRole('button', { name: 'Pay ₹1,020' })
    const input = d.getByLabelText('Credits to buy')
    await userEvent.clear(input)
    await userEvent.type(input, '3000')
    expect(d.queryByRole('button', { name: 'Pay ₹1,020' })).toBeNull() // old quote is not shown for a new amount
    const waiting = d.getByRole('button', { name: 'Getting the price…' }) as HTMLButtonElement // busy sign while the quote is pending
    expect(waiting.disabled).toBe(true)
    expect(waiting.getAttribute('aria-busy')).toBe('true')
    expect(await d.findByRole('button', { name: 'Pay ₹3,060' })).toBeTruthy()
    expect(getQuote).toHaveBeenLastCalledWith(3000)
  })

  it('R-47 validates on leaving the field (999 and 10,001), asks no quote, and disables Pay', async () => {
    renderWallet()
    const d = within(await openDialog())
    await d.findByRole('button', { name: 'Pay ₹1,020' })
    const input = d.getByLabelText('Credits to buy')
    await userEvent.clear(input)
    await userEvent.type(input, '999')
    expect(d.queryByRole('alert')).toBeNull() // not before leaving the field
    await userEvent.tab()
    expect((await d.findByRole('alert')).textContent).toContain('at least 1,000 credits')
    expect((d.getByRole('button', { name: 'Pay' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.clear(input)
    await userEvent.type(input, '10001')
    expect((await d.findByRole('alert')).textContent).toContain('up to 10,000 credits')
    expect((d.getByRole('button', { name: 'Pay' }) as HTMLButtonElement).disabled).toBe(true)
    await new Promise((r) => setTimeout(r, 450))
    expect(getQuote).not.toHaveBeenCalledWith(999)
    expect(getQuote).not.toHaveBeenCalledWith(10001)
    await userEvent.clear(input)
    await userEvent.type(input, '1200')
    await waitFor(() => expect(d.queryByRole('alert')).toBeNull())
    expect(await d.findByRole('button', { name: 'Pay ₹1,224' })).toBeTruthy()
  })

  it('R-47 shows the server field error when the quote is refused (422) and keeps Pay disabled', async () => {
    vi.mocked(getQuote).mockImplementation(async (c) => {
      if (c === 1500) throw new ApiError(422, 'Invalid', 'validation_error', { credits: 'That amount is not available.' })
      return quote(c)
    })
    renderWallet()
    const d = within(await openDialog())
    await d.findByRole('button', { name: 'Pay ₹1,020' })
    const input = d.getByLabelText('Credits to buy')
    await userEvent.clear(input)
    await userEvent.type(input, '1500')
    expect((await d.findByRole('alert')).textContent).toBe('That amount is not available.')
    expect((d.getByRole('button', { name: 'Pay' }) as HTMLButtonElement).disabled).toBe(true)
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('R-02 shows a server fields.credits error under the field and keeps what was typed', async () => {
    vi.mocked(createOrder).mockRejectedValue(new ApiError(422, 'Invalid', 'validation_error', { credits: 'Amount is not allowed.' }))
    renderWallet()
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    expect((await d.findByRole('alert')).textContent).toBe('Amount is not allowed.')
    expect((d.getByLabelText('Credits to buy') as HTMLInputElement).value).toBe('1000')
  })

  it('R-02 disables the pay button while the order is being created, so one click makes one order', async () => {
    let resolve!: (o: PaymentOrder) => void
    vi.mocked(createOrder).mockReturnValue(new Promise((r) => { resolve = r }))
    renderWallet()
    const d = within(await openDialog())
    const pay = await d.findByRole('button', { name: 'Pay ₹1,020' })
    await userEvent.click(pay)
    await userEvent.click(d.getByRole('button', { name: /Starting payment/ }))
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(d.getByRole('button', { name: /Starting payment/ }).getAttribute('aria-busy')).toBe('true')
    await act(async () => resolve(order(1000)))
    expect(await d.findByRole('button', { name: 'Pay' })).toBeTruthy() // mock step
  })

  it('R-02 shows the server message and a route to confirm the email when it is not confirmed (403)', async () => {
    vi.mocked(createOrder).mockRejectedValue(new ApiError(403, 'Confirm your email before buying credits.', 'email_not_verified'))
    renderWallet()
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    expect(await d.findByText(/Confirm your email before buying credits\./)).toBeTruthy()
    expect(d.getByRole('link', { name: /confirm your email/i }).getAttribute('href')).toBe('/account')
  })

  it('R-02 says nothing was charged when creating the order fails for another reason', async () => {
    vi.mocked(createOrder).mockRejectedValue(new ApiError(502, 'Payments are unavailable.', 'payment_provider_unavailable'))
    renderWallet()
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    expect((await d.findByRole('alert')).textContent).toContain('You were not charged')
  })
})

describe('after payment, mock mode', () => {
  it('R-02 mock Pay: verifies with the server, then shows the server balance and refetches the wallet', async () => {
    vi.mocked(createOrder).mockResolvedValue(order(1000))
    vi.mocked(mockCompletePayment).mockResolvedValue(proof)
    vi.mocked(verifyPayment).mockResolvedValue(verified(1000, 2000))
    renderWallet('mock')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    expect(d.getByText(/no real payment is made/)).toBeTruthy()
    expect(openCheckout).not.toHaveBeenCalled() // no external script in mock mode
    const walletCalls = vi.mocked(getWallet).mock.calls.length
    await userEvent.click(d.getByRole('button', { name: 'Pay' }))
    expect(await d.findByText(paragraph('1,000 credits were added to your wallet.'))).toBeTruthy()
    expect(mockCompletePayment).toHaveBeenCalledWith('o1', 'captured')
    expect(verifyPayment).toHaveBeenCalledWith('o1', 'pay_1', 'sig')
    expect(d.getByText('2,000 credits')).toBeTruthy()
    // The success state breaks the order's own figures into price and payment fee.
    expect(d.getByText((_, el) => el?.tagName === 'DT' && el.textContent === 'You paid (₹1,000 plus ₹20 payment fee)')).toBeTruthy()
    expect(d.getByText('₹1,020', { selector: 'dd' })).toBeTruthy()
    expect(d.getByRole('button', { name: 'Done' })).toBeTruthy()
    await waitFor(() => expect(vi.mocked(getWallet).mock.calls.length).toBeGreaterThan(walletCalls))
  })

  it('R-02 mock Fail shows the failed state and says no credits were added', async () => {
    vi.mocked(createOrder).mockResolvedValue(order(1000))
    vi.mocked(mockCompletePayment).mockResolvedValue(proof)
    renderWallet('mock')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await userEvent.click(d.getByRole('button', { name: 'Fail' }))
    expect(await d.findByText(/No credits were added/)).toBeTruthy()
    expect(verifyPayment).not.toHaveBeenCalled()
  })

  it('R-02 mock Cancel shows the cancelled state; Try again returns to the form with the same amount', async () => {
    vi.mocked(createOrder).mockResolvedValue(order(2500))
    renderWallet('mock')
    const d = within(await openDialog())
    await userEvent.click(d.getByRole('button', { name: '2,500 credits' }))
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹2,550' }))
    await userEvent.click(d.getByRole('button', { name: 'Cancel' }))
    expect(await d.findByRole('heading', { name: 'Payment cancelled' })).toBeTruthy()
    expect(d.getByText(/within 30 minutes/)).toBeTruthy()
    await userEvent.click(d.getByRole('button', { name: 'Try again' }))
    expect((d.getByLabelText('Credits to buy') as HTMLInputElement).value).toBe('2500')
  })

  it('R-02 a 400 from verify (bad signature) shows the failed state, never "added"', async () => {
    vi.mocked(createOrder).mockResolvedValue(order(1000))
    vi.mocked(mockCompletePayment).mockResolvedValue(proof)
    vi.mocked(verifyPayment).mockRejectedValue(new ApiError(400, 'Signature invalid', 'payment_signature_invalid'))
    renderWallet('mock')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await userEvent.click(d.getByRole('button', { name: 'Pay' }))
    expect(await d.findByRole('heading', { name: "The payment didn't go through" })).toBeTruthy()
    expect(d.queryByText(/added to your wallet/)).toBeNull()
  })

  it('R-02 a 409 payment_not_captured shows "confirming", polls the order every 2 s, then shows success from a fresh wallet read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(createOrder).mockResolvedValue(order(1000))
    vi.mocked(mockCompletePayment).mockResolvedValue(proof)
    vi.mocked(verifyPayment).mockRejectedValue(notCaptured())
    vi.mocked(getOrder)
      .mockResolvedValueOnce({ order_id: 'o1', status: 'created', credits: 1000, created_at: '2026-11-17T08:00:00Z' })
      .mockResolvedValue({ order_id: 'o1', status: 'paid', credits: 1000, created_at: '2026-11-17T08:00:00Z' })
    renderWallet('mock')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const d = within(await openDialog(user))
    await user.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await user.click(d.getByRole('button', { name: 'Pay' }))
    expect(await d.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    expect(d.queryByText(/added to your wallet/)).toBeNull()
    vi.mocked(getWallet).mockResolvedValue(wallet(2000))
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(getOrder).toHaveBeenCalledTimes(1)
    expect(d.queryByText(/added to your wallet/)).toBeNull() // still created
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(getOrder).toHaveBeenCalledTimes(2)
    expect(await d.findByText(paragraph('1,000 credits were added to your wallet.'))).toBeTruthy()
    expect(d.getByText('2,000 credits')).toBeTruthy()
  })

  it('R-02 after one minute without confirmation shows the "taking longer" text and stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(createOrder).mockResolvedValue(order(1000))
    vi.mocked(mockCompletePayment).mockResolvedValue(proof)
    vi.mocked(verifyPayment).mockRejectedValue(notCaptured())
    vi.mocked(getOrder).mockResolvedValue({ order_id: 'o1', status: 'created', credits: 1000, created_at: '2026-11-17T08:00:00Z' })
    renderWallet('mock')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const d = within(await openDialog(user))
    await user.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await user.click(d.getByRole('button', { name: 'Pay' }))
    await d.findByRole('heading', { name: 'Confirming your payment' })
    await act(async () => { await vi.advanceTimersByTimeAsync(61000) })
    expect(await d.findByText(/This is taking longer than usual/)).toBeTruthy()
    const calls = vi.mocked(getOrder).mock.calls.length
    expect(calls).toBeLessThanOrEqual(31)
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(vi.mocked(getOrder).mock.calls.length).toBe(calls)
    expect(d.queryByText(/added to your wallet/)).toBeNull()
  })

  it('R-02 polling that finds the order failed shows the failed state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(createOrder).mockResolvedValue(order(1000))
    vi.mocked(mockCompletePayment).mockResolvedValue(proof)
    vi.mocked(verifyPayment).mockRejectedValue(notCaptured())
    vi.mocked(getOrder).mockResolvedValue({ order_id: 'o1', status: 'failed', credits: 1000, created_at: '2026-11-17T08:00:00Z' })
    renderWallet('mock')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const d = within(await openDialog(user))
    await user.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await user.click(d.getByRole('button', { name: 'Pay' }))
    await d.findByRole('heading', { name: 'Confirming your payment' })
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(await d.findByRole('heading', { name: "The payment didn't go through" })).toBeTruthy()
  })
})

describe('after payment, razorpay mode', () => {
  let args: OpenCheckoutArgs
  beforeEach(() => {
    vi.mocked(createOrder).mockResolvedValue(order(1000))
    vi.mocked(openCheckout).mockImplementation(async (a) => { args = a })
  })

  it('R-02 opens Checkout with the server order (key from the API) and does not call the mock route', async () => {
    renderWallet('razorpay')
    const d = within(await openDialog())
    await userEvent.click(d.getByRole('button', { name: '1,000 credits' }))
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await waitFor(() => expect(openCheckout).toHaveBeenCalledTimes(1))
    expect(args.order).toEqual(order(1000))
    expect(mockCompletePayment).not.toHaveBeenCalled()
  })

  it('R-02 a Checkout success is not a payment: shows "confirming" until verify answers, then the server balance', async () => {
    let resolve!: (v: PaymentVerified) => void
    vi.mocked(verifyPayment).mockReturnValue(new Promise((r) => { resolve = r }))
    renderWallet('razorpay')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await waitFor(() => expect(openCheckout).toHaveBeenCalled())
    act(() => args.onSuccess({ razorpay_payment_id: 'pay_9', razorpay_order_id: 'order_rz1', razorpay_signature: 's9' }))
    expect(await d.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    expect(d.queryByText(/added to your wallet/)).toBeNull()
    expect(verifyPayment).toHaveBeenCalledWith('o1', 'pay_9', 's9')
    await act(async () => resolve(verified(1000, 2000)))
    expect(await d.findByText(paragraph('1,000 credits were added to your wallet.'))).toBeTruthy()
    expect(d.getByText('2,000 credits')).toBeTruthy()
  })

  it('R-02 our dialog closes while the Razorpay window is open, so Checkout is usable, and reopens after', async () => {
    renderWallet('razorpay')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await waitFor(() => expect(openCheckout).toHaveBeenCalled())
    const dialog = document.querySelector('dialog') as HTMLDialogElement
    await waitFor(() => expect(dialog.open).toBe(false))
    act(() => args.onDismiss())
    await waitFor(() => expect(dialog.open).toBe(true))
    expect(await d.findByRole('heading', { name: 'Payment cancelled' })).toBeTruthy()
  })

  it('R-02 a failed attempt inside Checkout does not reopen our dialog; a later success inside Checkout is verified', async () => {
    vi.mocked(verifyPayment).mockResolvedValue(verified(1000, 1000))
    renderWallet('razorpay')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await waitFor(() => expect(openCheckout).toHaveBeenCalled())
    const dialog = document.querySelector('dialog') as HTMLDialogElement
    act(() => args.onFailed({ error: { code: 'BAD_REQUEST_ERROR' } }))
    expect(dialog.open).toBe(false)
    act(() => args.onSuccess({ razorpay_payment_id: 'pay_2', razorpay_order_id: 'order_rz1', razorpay_signature: 's2' }))
    expect(await d.findByText(paragraph('1,000 credits were added to your wallet.'))).toBeTruthy()
    expect(dialog.open).toBe(true)
  })

  it('R-02 a payment.failed then closing the window shows the failed state; Try again keeps the amount', async () => {
    renderWallet('razorpay')
    const d = within(await openDialog())
    await userEvent.click(d.getByRole('button', { name: '5,000 credits' }))
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹5,100' }))
    await waitFor(() => expect(openCheckout).toHaveBeenCalled())
    act(() => args.onFailed({ error: { code: 'BAD_REQUEST_ERROR' } }))
    act(() => args.onDismiss())
    expect(await d.findByRole('heading', { name: "The payment didn't go through" })).toBeTruthy()
    expect(d.getByText(/No credits were added/)).toBeTruthy()
    await userEvent.click(d.getByRole('button', { name: 'Try again' }))
    expect((d.getByLabelText('Credits to buy') as HTMLInputElement).value).toBe('5000')
  })

  it('R-02 closing the Checkout window shows the cancelled state', async () => {
    renderWallet('razorpay')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await waitFor(() => expect(openCheckout).toHaveBeenCalled())
    act(() => args.onDismiss())
    expect(await d.findByRole('heading', { name: 'Payment cancelled' })).toBeTruthy()
  })

  it('R-02 a window close that follows a failure does not replace the failed state', async () => {
    renderWallet('razorpay')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await waitFor(() => expect(openCheckout).toHaveBeenCalled())
    act(() => args.onFailed({ error: {} }))
    act(() => args.onDismiss())
    expect(await d.findByRole('heading', { name: "The payment didn't go through" })).toBeTruthy()
  })

  it('R-02 shows an error and no charge when the payment window cannot load', async () => {
    vi.mocked(openCheckout).mockRejectedValue(new Error('The payment window did not load.'))
    renderWallet('razorpay')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    expect((await d.findByRole('alert')).textContent).toContain('You were not charged')
  })
})

describe('fix round 3', () => {
  it('R-02 closing the dialog while the server confirms still refreshes the balance and transactions when verify answers', async () => {
    vi.mocked(createOrder).mockResolvedValue(order(1000))
    vi.mocked(mockCompletePayment).mockResolvedValue(proof)
    let answer: (v: PaymentVerified) => void = () => {}
    vi.mocked(verifyPayment).mockImplementation(() => new Promise((r) => { answer = r }))
    renderWallet('mock')
    const dialog = await openDialog()
    const d = within(dialog)
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await userEvent.click(d.getByRole('button', { name: 'Pay' }))
    expect(await d.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    await userEvent.click(d.getAllByRole('button', { name: 'Close' }).at(-1)!) // the "Close" button under the message
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // The close itself refetches once; then nothing else is pending.
    await waitFor(() => expect(getTransactions).toHaveBeenCalled())
    const walletCalls = vi.mocked(getWallet).mock.calls.length
    const txCalls = vi.mocked(getTransactions).mock.calls.length
    vi.mocked(getWallet).mockResolvedValue(wallet(2000)) // the server's balance after confirming
    await act(async () => { answer(verified(1000, 2000)) })
    await waitFor(() => expect(vi.mocked(getWallet).mock.calls.length).toBeGreaterThan(walletCalls))
    await waitFor(() => expect(vi.mocked(getTransactions).mock.calls.length).toBeGreaterThan(txCalls))
    // The page shows the refetched server balance, never the verify answer from component state.
    // (The header pill repeats the figure as hidden visible text; this is the page's own balance.)
    expect(await screen.findByText('2,000', { ignore: 'script, style, [aria-hidden="true"]' })).toBeTruthy()
    expect(screen.queryByText(/added to your wallet/)).toBeNull()
  })

  it('R-02 reopening the dialog before verify answers still refreshes the wallet once verify settles (even with an error)', async () => {
    vi.mocked(createOrder).mockResolvedValue(order(1000))
    vi.mocked(mockCompletePayment).mockResolvedValue(proof)
    let fail: (e: unknown) => void = () => {}
    vi.mocked(verifyPayment).mockImplementation(() => new Promise((_, rej) => { fail = rej }))
    renderWallet('mock')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await userEvent.click(d.getByRole('button', { name: 'Pay' }))
    expect(await d.findByRole('heading', { name: 'Confirming your payment' })).toBeTruthy()
    await userEvent.click(d.getAllByRole('button', { name: 'Close' }).at(-1)!)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const reopened = within(await openDialog()) // a new instance (new key); the old one is unmounted
    expect(await reopened.findByRole('button', { name: 'Pay ₹1,020' })).toBeTruthy()
    const walletCalls = vi.mocked(getWallet).mock.calls.length
    await act(async () => { fail(new Error('Network error')) })
    await waitFor(() => expect(vi.mocked(getWallet).mock.calls.length).toBeGreaterThan(walletCalls))
    expect(reopened.getByRole('heading', { name: 'Buy credits' })).toBeTruthy() // the new dialog is not disturbed
    expect(getOrder).not.toHaveBeenCalled() // the closed instance does not start polling
  })

  it('R-47 asks for one quote when the dialog opens and none while it is closed', async () => {
    renderWallet()
    await screen.findByRole('button', { name: 'Buy credits' })
    await new Promise((r) => setTimeout(r, 50))
    expect(getQuote).not.toHaveBeenCalled()
    const d = within(await openDialog())
    await d.findByRole('button', { name: 'Pay ₹1,020' })
    await new Promise((r) => setTimeout(r, 400))
    expect(getQuote).toHaveBeenCalledTimes(1)
  })

  it('R-47 keeps the GST line in place (with a dash) while the price loads when config has GST on the fee', async () => {
    vi.mocked(getConfig).mockResolvedValue({ ...config('mock'), payment_fee_gst_bps: 1800 })
    let give: (q: PaymentQuote) => void = () => {}
    vi.mocked(getQuote).mockImplementation(() => new Promise((r) => { give = r }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/wallet'] })} /></QueryClientProvider>)
    const dialog = await openDialog()
    const d = within(dialog)
    const gst = d.getByText('GST on the fee').closest('div') as HTMLElement
    expect(within(gst).getByText('—')).toBeTruthy()
    expect(dialog.querySelector('dl')?.getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(getQuote).toHaveBeenCalled())
    await act(async () => { give({ credits: 1000, price_paise: 100000, fee_paise: 2050, fee_gst_paise: 368, amount_paise: 102418 }) })
    expect(await d.findByRole('button', { name: 'Pay ₹1,024.18' })).toBeTruthy()
    expect(within(d.getByText('GST on the fee').closest('div') as HTMLElement).getByText('₹3.68')).toBeTruthy()
    expect(dialog.querySelector('dl')?.getAttribute('aria-busy')).toBeNull()
  })

  it('R-02 mock mode: a failed payment does not mention the Razorpay window', async () => {
    vi.mocked(createOrder).mockResolvedValue(order(1000))
    vi.mocked(mockCompletePayment).mockResolvedValue(proof)
    renderWallet('mock')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await userEvent.click(d.getByRole('button', { name: 'Fail' }))
    expect((await d.findByRole('alert')).textContent).toBe('No credits were added. Try again.')
  })

  it('R-02 mock mode: when the mock completion call itself fails, it never says no credits were added', async () => {
    vi.mocked(createOrder).mockResolvedValue(order(1000))
    vi.mocked(mockCompletePayment).mockRejectedValue(new ApiError(500, 'Internal Server Error', 'unknown'))
    renderWallet('mock')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    const walletCalls = vi.mocked(getWallet).mock.calls.length
    await userEvent.click(d.getByRole('button', { name: 'Pay' }))
    expect(await d.findByRole('heading', { name: 'Payment not confirmed yet' })).toBeTruthy()
    expect(d.getByRole('alert').textContent).toContain('could not confirm this payment yet')
    expect(d.queryByText(/No credits were added/)).toBeNull()
    await waitFor(() => expect(vi.mocked(getWallet).mock.calls.length).toBeGreaterThan(walletCalls))
  })

  it('R-02 live mode keeps its failed wording exactly', async () => {
    let args = {} as OpenCheckoutArgs
    vi.mocked(getConfig).mockResolvedValue(config('razorpay'))
    vi.mocked(createOrder).mockResolvedValue(order(1000))
    vi.mocked(openCheckout).mockImplementation(async (a) => { args = a })
    renderWallet('razorpay')
    const d = within(await openDialog())
    await userEvent.click(await d.findByRole('button', { name: 'Pay ₹1,020' }))
    await waitFor(() => expect(openCheckout).toHaveBeenCalled())
    act(() => args.onFailed({ error: {} }))
    act(() => args.onDismiss())
    expect((await d.findByRole('alert')).textContent).toBe('No credits were added. Try again, or choose another way to pay in the Razorpay window.')
  })
})
