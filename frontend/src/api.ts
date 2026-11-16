export interface Config {
  provider: 'mock' | 'fal'
  max_audio_seconds: number
  max_script_chars: number
  max_image_mb: number
  languages: string[]
  video_price_per_second_usd: number
}

export interface Job {
  id: string
  status: string
  language: string
  script: string
  audio_duration_seconds: number | null
  estimated_video_cost_usd: number | null
  audio_url: string | null
  video_url: string | null
  error: string | null
  created_at: string
  updated_at: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
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
    res = await fetch(url, init)
  } catch {
    throw new NetworkError('Network error')
  }
  if (!res.ok) {
    let detail: unknown
    try {
      detail = (await res.json()).detail
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, detailToMessage(detail, `Request failed (${res.status})`))
  }
  return (await res.json()) as T
}

export const getConfig = () => request<Config>('/api/config')

export const getJob = (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}`)

export const approveJob = (id: string) =>
  request<Job>(`/api/jobs/${encodeURIComponent(id)}/approve`, { method: 'POST' })

export function createJob(image: File, script: string, language: string): Promise<Job> {
  const body = new FormData()
  body.append('image', image)
  body.append('script', script)
  body.append('language', language)
  return request<Job>('/api/jobs', { method: 'POST', body })
}
