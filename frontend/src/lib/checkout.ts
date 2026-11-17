import type { PaymentOrder } from '../api/client'

/**
 * Razorpay Standard Checkout (docs/RAZORPAY-FACTS.md section E). Only the options stated there are used.
 * Loaded only in `razorpay` mode, only once, and never in tests (they stub this module).
 */
const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js' // FACTS E, "Script"

export interface CheckoutHandlerResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}
export interface CheckoutFailure {
  error: { code?: string; description?: string; source?: string; step?: string; reason?: string }
}
interface CheckoutInstance {
  open: () => void
  on: (event: 'payment.failed', cb: (response: CheckoutFailure) => void) => void
}
type CheckoutCtor = new (options: Record<string, unknown>) => CheckoutInstance

const global = () => window as unknown as { Razorpay?: CheckoutCtor }

let loading: Promise<CheckoutCtor> | null = null

export function loadCheckout(): Promise<CheckoutCtor> {
  const existing = global().Razorpay
  if (existing) return Promise.resolve(existing)
  loading ??= new Promise<CheckoutCtor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => {
      const ctor = global().Razorpay
      if (ctor) resolve(ctor)
      else {
        loading = null
        reject(new Error('The payment window did not load.'))
      }
    }
    script.onerror = () => {
      loading = null // allow a retry
      script.remove()
      reject(new Error('The payment window did not load.'))
    }
    document.head.appendChild(script)
  })
  return loading
}

export interface OpenCheckoutArgs {
  order: PaymentOrder
  onSuccess: (response: CheckoutHandlerResponse) => void
  onFailed: (response: CheckoutFailure) => void
  onDismiss: () => void
}

/**
 * Opens Checkout for a server-created order. Options (FACTS E): key, amount, currency, order_id, name
 * (mandatory); handler; modal.ondismiss; event payment.failed. The key id and amount come from the API.
 */
export async function openCheckout({ order, onSuccess, onFailed, onDismiss }: OpenCheckoutArgs): Promise<void> {
  const Razorpay = await loadCheckout()
  const rzp = new Razorpay({
    key: order.key_id,
    amount: String(order.amount_paise),
    currency: 'INR',
    order_id: order.razorpay_order_id,
    name: 'Frameforge',
    handler: onSuccess,
    modal: { ondismiss: onDismiss },
  })
  rzp.on('payment.failed', onFailed)
  rzp.open()
}
