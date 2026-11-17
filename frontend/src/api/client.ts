import type { components } from './schema'

export type Config = components['schemas']['ConfigOut']
export type Job = components['schemas']['JobOut']

export class ApiError extends Error {
  status: number
  code: string
  /** Per-field messages from the server ({field: message}); empty when the error is not about one field. */
  fields: Record<string, string>
  constructor(status: number, message: string, code = 'unknown', fields: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

function toFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, msg] of Object.entries(value)) if (typeof msg === 'string') out[key] = msg
  return out
}

/** Network-level failure (no HTTP response). */
export class NetworkError extends Error {}

function detailToMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : ''))
      .filter(Boolean)
    if (msgs.length) return msgs.join('; ')
  }
  return fallback
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { credentials: 'same-origin', ...init })
  } catch {
    throw new NetworkError('Network error')
  }
  if (!res.ok) {
    let detail: unknown
    let code = 'unknown'
    let fields: Record<string, string> = {}
    try {
      const body = await res.json()
      detail = body.detail
      if (typeof body.code === 'string') code = body.code
      fields = toFields(body.fields)
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, detailToMessage(detail, `Request failed (${res.status})`), code, fields)
  }
  // 202 and 204 answers have no body.
  if (res.status === 202 || res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const getConfig = () => request<Config>('/api/v1/config')

export const getJob = (id: string) => request<Job>(`/api/v1/jobs/${encodeURIComponent(id)}`)

/** Approve a job. `bannerId` is the customer's chosen banner (D-067); sent only when given. */
export const approveJob = (id: string, bannerId?: string) =>
  request<Job>(
    `/api/v1/jobs/${encodeURIComponent(id)}/approve`,
    bannerId === undefined
      ? { method: 'POST' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ banner_id: bannerId }) },
  )

/**
 * Start a job. `scriptId` is sent instead of the text, only for a saved script the customer did not
 * change (the server fills in the text); otherwise the text is sent. The language always goes.
 */
export function createJob(
  image: File,
  script: string,
  language: string,
  scriptId?: string,
  consent?: { consent: boolean; version: string },
): Promise<Job> {
  const body = new FormData()
  body.append('image', image)
  if (scriptId) body.append('script_id', scriptId)
  else body.append('script', script)
  body.append('language', language)
  if (consent?.consent) {
    body.append('consent', 'true')
    body.append('consent_version', consent.version)
  }
  return request<Job>('/api/v1/jobs', { method: 'POST', body })
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const post: RequestInit = { method: 'POST' }

export type User = components['schemas']['UserOut']

/** TanStack Query key for the logged-in user. One key for the whole app (screens, guard, account). */
export const meKey = ['me'] as const

// Auth (M2 contract, T-200). The session is an HttpOnly cookie the page cannot read.
export const signup = (name: string, email: string, password: string) =>
  request<User>('/api/v1/auth/signup', json({ name, email, password }))
export const login = (email: string, password: string) =>
  request<User>('/api/v1/auth/login', json({ email, password }))
export const logout = () => request<void>('/api/v1/auth/logout', post)
export const logoutAll = () => request<void>('/api/v1/auth/logout-all', post)
export const getMe = () => request<User>('/api/v1/auth/me')
export const verifyEmail = (token: string) => request<void>('/api/v1/auth/verify-email', json({ token }))
export const resendVerification = () => request<void>('/api/v1/auth/verify-email/resend', post)
export const forgotPassword = (email: string) => request<void>('/api/v1/auth/password/forgot', json({ email }))
export const checkResetToken = (token: string) =>
  request<components['schemas']['ResetCheckOut']>('/api/v1/auth/password/reset/check', json({ token }))
export const resetPassword = (token: string, password: string) =>
  request<void>('/api/v1/auth/password/reset', json({ token, password }))
export const changePassword = (currentPassword: string, newPassword: string) =>
  request<void>('/api/v1/auth/password/change', json({ current_password: currentPassword, new_password: newPassword }))

// Wallet (M3 contract, T-300). Amounts are whole credits decided by the server; never compute them here.
export type Wallet = components['schemas']['WalletOut']
export type Transactions = components['schemas']['TransactionsOut']
export type LedgerEntry = components['schemas']['LedgerEntryOut']

/** TanStack Query keys for the wallet. Invalidate `walletKey` after anything that can charge. */
export const walletKey = ['wallet'] as const
export const transactionsKey = (page: number, pageSize: number) => ['wallet', 'transactions', page, pageSize] as const

export const getWallet = () => request<Wallet>('/api/v1/wallet')
export const getTransactions = (page = 1, pageSize = 20) =>
  request<Transactions>(`/api/v1/wallet/transactions?page=${page}&page_size=${pageSize}`)

// Payments (M4 contract, T-410). The server decides every amount; the browser sends only the credits wanted.
export type PaymentOrder = components['schemas']['OrderOut']
export type PaymentOrderStatus = components['schemas']['OrderStatusOut']
export type PaymentVerified = components['schemas']['VerifyOut']
export type PaymentProof = components['schemas']['MockCompleteOut']

// Price, payment fee and total for an amount of credits (D-060). Shown as returned; never computed in the browser.
export type PaymentQuote = components['schemas']['QuoteOut']
export const quoteKey = (credits: number) => ['payment-quote', credits] as const
export const getQuote = (credits: number) => request<PaymentQuote>(`/api/v1/payments/quote?credits=${credits}`)

export const createOrder = (credits: number) => request<PaymentOrder>('/api/v1/payments/orders', json({ credits }))
export const getOrder = (orderId: string) =>
  request<PaymentOrderStatus>(`/api/v1/payments/orders/${encodeURIComponent(orderId)}`)
export const verifyPayment = (orderId: string, razorpayPaymentId: string, razorpaySignature: string) =>
  request<PaymentVerified>(
    '/api/v1/payments/verify',
    json({ order_id: orderId, razorpay_payment_id: razorpayPaymentId, razorpay_signature: razorpaySignature }),
  )
/** Mock mode only: what Checkout's handler would give the browser. 404 in any other mode. */
export const mockCompletePayment = (orderId: string, outcome: 'captured' | 'failed') =>
  request<PaymentProof>('/api/v1/payments/mock/complete', json({ order_id: orderId, outcome }))

// Job list (M5 contract, T-501). Home and Videos read it; the server filters and pages.
export type JobSummary = components['schemas']['JobSummaryOut']
export type JobsPage = components['schemas']['JobsOut']
export type JobListParams = { status?: string; q?: string; page?: number; page_size?: number }

export const jobListKey = (params: JobListParams = {}) => ['jobs', params] as const

export function listJobs(params: JobListParams = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const query = qs.toString()
  return request<JobsPage>(`/api/v1/jobs${query ? `?${query}` : ''}`)
}

// Saved scripts (M5 contract, T-504). Script text is plain text; the server decides what counts as a duplicate.
export type SavedScript = components['schemas']['ScriptOut']
export type ScriptsPage = components['schemas']['ScriptsOut']
export type ScriptListParams = { q?: string; language?: string; page?: number; page_size?: number }

/** Prefix of every saved-script query: invalidate it after a delete or a job that saves or touches a script. */
export const scriptsKey = ['scripts'] as const
export const scriptListKey = (params: ScriptListParams = {}) => ['scripts', 'list', params] as const
export const scriptKey = (id: string) => ['scripts', 'one', id] as const

export function listScripts(params: ScriptListParams = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const query = qs.toString()
  return request<ScriptsPage>(`/api/v1/scripts${query ? `?${query}` : ''}`)
}
export const getScript = (id: string) => request<SavedScript>(`/api/v1/scripts/${encodeURIComponent(id)}`)
/** My scripts → New script: saved without making a voice; the server applies the Create checks. */
export const createScript = (language: string, text: string) =>
  request<SavedScript>('/api/v1/scripts', json({ language, text }))
export const deleteScript = (id: string) =>
  request<void>(`/api/v1/scripts/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** A job's video as a file, for "Download video" on the same page. Our route checks the owner and
 * redirects to the provider's file (D-065), which allows cross-origin reads, so the browser can
 * save it without opening a new tab. */
export async function fetchVideoFile(videoPath: string): Promise<Blob> {
  const res = await fetch(videoPath, { credentials: 'same-origin' })
  if (res.status === 410) throw new ApiError(410, 'This video has expired. Videos are kept for 30 days.', 'video_expired')
  if (!res.ok) throw new ApiError(res.status, 'We could not download the video. Please try again.', 'download_failed')
  return res.blob()
}

// Banners (D-067): the customer's own logo or banner images; one is chosen for each video.
export type Banner = components['schemas']['BannerOut']
export const bannersKey = ['banners'] as const
export const listBanners = () => request<components['schemas']['BannersOut']>('/api/v1/banners')
export function createBanner(name: string, file: File): Promise<Banner> {
  const body = new FormData()
  body.append('name', name)
  body.append('image', file)
  return request<Banner>('/api/v1/banners', { method: 'POST', body })
}
export const deleteBanner = (id: string) =>
  request<void>(`/api/v1/banners/${encodeURIComponent(id)}`, { method: 'DELETE' })
