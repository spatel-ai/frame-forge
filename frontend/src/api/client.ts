import type { components } from './schema'

export type Config = components['schemas']['ConfigOut']
export type Job = components['schemas']['JobOut']

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = 'unknown') {
    super(message)
    this.status = status
    this.code = code
  }
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { credentials: 'same-origin', ...init })
  } catch {
    throw new NetworkError('Network error')
  }
  if (!res.ok) {
    let detail: unknown
    let code = 'unknown'
    try {
      const body = await res.json()
      detail = body.detail
      if (typeof body.code === 'string') code = body.code
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, detailToMessage(detail, `Request failed (${res.status})`), code)
  }
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
