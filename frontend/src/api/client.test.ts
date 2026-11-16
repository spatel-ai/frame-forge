import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError, getJob } from './client'

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (e) {
    return e
  }
  throw new Error('expected a rejection')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('API client errors', () => {
  it('R-79 carries the per-field messages the server names', async () => {
    respond(422, { detail: 'Check the script.', code: 'validation_error', fields: { script: 'Enter a script.' } })
    const err = await caught(getJob('abc'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 422, code: 'validation_error', message: 'Check the script.', fields: { script: 'Enter a script.' } })
  })

  it('R-79 gives an empty field map when the server sends none, or sends something malformed', async () => {
    respond(409, { detail: 'Already approved.', code: 'invalid_state' })
    expect(await caught(getJob('abc'))).toMatchObject({ code: 'invalid_state', fields: {} })

    respond(422, { detail: 'Bad.', code: 'validation_error', fields: ['script', 5] })
    expect(await caught(getJob('abc'))).toMatchObject({ fields: {} })

    respond(422, { detail: 'Bad.', code: 'validation_error', fields: { script: 'Enter a script.', image: 7 } })
    expect(await caught(getJob('abc'))).toMatchObject({ fields: { script: 'Enter a script.' } })
  })

  it('keeps a non-JSON error body readable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })))
    expect(await caught(getJob('abc'))).toMatchObject({ status: 502, code: 'unknown', message: 'Request failed (502)', fields: {} })
  })

  it('reports a network failure as NetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect(await caught(getJob('abc'))).toBeInstanceOf(NetworkError)
  })
})

describe('API client auth calls', () => {
  it('R-01 sends JSON with the same-origin cookie and returns the user', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'u1', name: 'Asha' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { login } = await import('./client')
    await expect(login('asha@example.com', 'correct horse')).resolves.toMatchObject({ id: 'u1' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/auth/login')
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } })
    expect(JSON.parse(init.body as string)).toEqual({ email: 'asha@example.com', password: 'correct horse' })
  })

  it('R-01 treats 202 and 204 as success with no body', async () => {
    const { forgotPassword, logout } = await import('./client')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 202 })))
    await expect(forgotPassword('a@b.co')).resolves.toBeUndefined()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    await expect(logout()).resolves.toBeUndefined()
  })
})
