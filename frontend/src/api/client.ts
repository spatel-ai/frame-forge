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

export const approveJob = (id: string) =>
  request<Job>(`/api/v1/jobs/${encodeURIComponent(id)}/approve`, { method: 'POST' })

export function createJob(image: File, script: string, language: string): Promise<Job> {
  const body = new FormData()
  body.append('image', image)
  body.append('script', script)
  body.append('language', language)
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
