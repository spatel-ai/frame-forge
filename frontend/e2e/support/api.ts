// A small client for the backend's own API, used by the global setup and the seed script.
// It talks to the site address (the dev server proxies /api to the backend), exactly as the
// browser does. No Origin header is sent, which the backend accepts (D-035).
import { readFileSync } from 'node:fs'
import { BACKEND_LOG, BASE_URL } from './env.ts'

export const SESSION_COOKIE = 'ff_session'

export class ApiFail extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(`${status} ${code}: ${message}`)
    this.status = status
    this.code = code
  }
}

export type Session = { cookie: string }

export async function call(
  path: string,
  init: RequestInit & { session?: Session } = {},
): Promise<{ res: Response; body: any }> {
  const headers = new Headers(init.headers)
  if (init.session) headers.set('cookie', `${SESSION_COOKIE}=${init.session.cookie}`)
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers })
  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { res, body }
}

export async function ok(path: string, init: RequestInit & { session?: Session } = {}): Promise<any> {
  const { res, body } = await call(path, init)
  if (!res.ok) throw new ApiFail(res.status, body?.code ?? 'error', body?.message ?? String(body))
  return body
}

export function json(data: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }
}

/** Log in and return the session token from the Set-Cookie header, or null on a wrong login. */
export async function login(email: string, password: string): Promise<Session | null> {
  const { res } = await call('/api/v1/auth/login', json({ email, password }))
  if (!res.ok) return null
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))
  if (!header) throw new Error('Login answered without a session cookie.')
  return { cookie: header.split(';')[0].slice(SESSION_COOKIE.length + 1) }
}

/** The newest link of a kind that the backend wrote to its log (development emails go there). */
export function linkFromLog(kind: 'verify-email' | 'reset-password'): string | null {
  let text: string
  try {
    text = readFileSync(BACKEND_LOG, 'utf8')
  } catch {
    return null
  }
  const all = [...text.matchAll(new RegExp(`/${kind}\\?token=([A-Za-z0-9_-]+)`, 'g'))]
  return all.length ? all[all.length - 1][1] : null
}
