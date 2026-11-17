import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJob, deleteScript, getScript, listScripts } from './client'

afterEach(() => vi.unstubAllGlobals())

function stub(status = 200, body: unknown = {}) {
  const fetchMock = vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const call = (m: ReturnType<typeof stub>) => m.mock.calls[0] as unknown as [string, RequestInit]

describe('saved scripts client', () => {
  it('R-43 lists with q, language and paging, leaving empty values out', async () => {
    const m = stub(200, { items: [], total: 0, page: 1, page_size: 10 })
    await listScripts({ page: 2, page_size: 10, q: 'holi', language: '' })
    expect(call(m)[0]).toBe('/api/v1/scripts?page=2&page_size=10&q=holi')
  })

  it('R-43 reads one script and deletes one with DELETE, accepting 204', async () => {
    const m = stub(200, { id: 's 1' })
    await getScript('s 1')
    expect(call(m)[0]).toBe('/api/v1/scripts/s%201')
    const d = stub(204)
    await expect(deleteScript('s1')).resolves.toBeUndefined()
    expect(call(d)[0]).toBe('/api/v1/scripts/s1')
    expect(call(d)[1].method).toBe('DELETE')
  })

  it('R-43 createJob sends script_id and no text for a saved script, and the text otherwise', async () => {
    const image = new File([new Uint8Array(1)], 'a.jpg', { type: 'image/jpeg' })
    const withId = stub(200, {})
    await createJob(image, 'Hello', 'English', 's1')
    const idForm = call(withId)[1].body as FormData
    expect(idForm.get('script_id')).toBe('s1')
    expect(idForm.has('script')).toBe(false)
    expect(idForm.get('language')).toBe('English')

    const withText = stub(200, {})
    await createJob(image, 'Hello', 'English')
    const textForm = call(withText)[1].body as FormData
    expect(textForm.get('script')).toBe('Hello')
    expect(textForm.has('script_id')).toBe(false)
  })
})
