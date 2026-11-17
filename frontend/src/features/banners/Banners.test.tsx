import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createBanner, deleteBanner, getConfig, getMe, getWallet, listBanners } from '../../api/client'
import type { Banner, Config, User } from '../../api/client'
import { routes } from '../../routes'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfig: vi.fn(),
  getMe: vi.fn(),
  getWallet: vi.fn(),
  listBanners: vi.fn(),
  createBanner: vi.fn(),
  deleteBanner: vi.fn(),
}))

const config: Config = {
  provider: 'mock', max_audio_seconds: 60, max_script_chars: 800, max_image_mb: 1, languages: ['English'],
  credits_per_second: 20, voice_price_credits: 10, payments: 'mock', razorpay_key_id: null,
  min_purchase_credits: 1000, max_purchase_credits: 10000, payment_fee_bps: 200, payment_fee_gst_bps: 0,
  support_email: null, consent_version: 'v', consent_text: 'ok', daily_video_limit: 50, banners_enabled: true,
}
const banner = (i: number): Banner => ({
  id: `b${i}`, name: `Banner ${i}`, image_url: `/api/v1/banners/b${i}/image`, created_at: '2026-11-10T10:00:00Z',
})
const png = () => new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' })

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return userEvent.setup({ applyAccept: false })
}

beforeEach(() => {
  vi.resetAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  vi.mocked(getConfig).mockResolvedValue(config)
  vi.mocked(getWallet).mockResolvedValue({ available_credits: 500, reserved_credits: 0, balance_credits: 500 })
  vi.mocked(getMe).mockResolvedValue({ id: 'u1', name: 'Asha', email: 'a@example.com', email_verified: true, role: 'user', active_sessions: 1 } as User)
})

async function openUpload(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Upload banner' }))
  return within(await screen.findByRole('dialog'))
}

describe('Banners page (D-067)', () => {
  it('R-85: the Banners nav item leads to the page with its title and intro', async () => {
    vi.mocked(listBanners).mockResolvedValue({ items: [banner(1)] })
    const user = renderAt('/')
    await user.click((await screen.findAllByRole('link', { name: 'Banners' }))[0])
    expect(await screen.findByRole('heading', { level: 1, name: 'Banners' })).toBeTruthy()
    expect(screen.getByText(/Upload your logo or banner image\. You choose one for each video/)).toBeTruthy()
  })

  it('R-85: shows a loading skeleton first', async () => {
    vi.mocked(listBanners).mockReturnValue(new Promise(() => {}))
    renderAt('/banners')
    expect(await screen.findByText('Loading your banners')).toBeTruthy()
  })

  it('R-85: lists banners with preview, name and uploaded date', async () => {
    vi.mocked(listBanners).mockResolvedValue({ items: [banner(1), banner(2)] })
    renderAt('/banners')
    expect(await screen.findByText('Banner 1')).toBeTruthy()
    expect(screen.getByText('Banner 2')).toBeTruthy()
    expect((screen.getByAltText('Preview of Banner 1') as HTMLImageElement).getAttribute('src')).toBe('/api/v1/banners/b1/image')
    expect(screen.getAllByText('Uploaded 10 Nov 2026')).toHaveLength(2)
  })

  it('R-85: empty state offers the first upload', async () => {
    vi.mocked(listBanners).mockResolvedValue({ items: [] })
    const user = renderAt('/banners')
    expect(await screen.findByText('No banners yet')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Upload your first banner' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('R-85: a load failure shows the error and Try again reloads', async () => {
    vi.mocked(listBanners).mockRejectedValueOnce(new ApiError(500, 'Server broke', 'server_error'))
    vi.mocked(listBanners).mockResolvedValue({ items: [banner(1)] })
    const user = renderAt('/banners')
    expect(await screen.findByText('We could not load your banners')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByText('Banner 1')).toBeTruthy()
  })

  it('R-85: upload sends name and image, closes the dialog and refreshes the list', async () => {
    vi.mocked(listBanners).mockResolvedValueOnce({ items: [] }).mockResolvedValue({ items: [banner(1)] })
    vi.mocked(createBanner).mockResolvedValue(banner(1))
    const user = renderAt('/banners')
    await screen.findByText('No banners yet')
    const d = await openUpload(user)
    await user.type(d.getByLabelText(/Banner name/), '  Shop logo ')
    await user.upload(d.getByLabelText(/Banner image/), png())
    await user.click(d.getByRole('button', { name: 'Upload banner' }))
    expect(createBanner).toHaveBeenCalledWith('Shop logo', expect.any(File))
    expect(await screen.findByText('Banner 1')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('R-85: client checks put messages under the fields and send nothing', async () => {
    vi.mocked(listBanners).mockResolvedValue({ items: [] })
    const user = renderAt('/banners')
    await screen.findByText('No banners yet')
    const d = await openUpload(user)
    await user.click(d.getByRole('button', { name: 'Upload banner' }))
    expect(d.getByText('Give the banner a name.')).toBeTruthy()
    expect(d.getByText('Choose an image for the banner.')).toBeTruthy()
    await user.upload(d.getByLabelText(/Banner image/), new File(['x'], 'a.gif', { type: 'image/gif' }))
    expect(await d.findByText('That file type is not supported. Choose a PNG, JPEG or WebP image.')).toBeTruthy()
    await user.upload(d.getByLabelText(/Banner image/), new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))
    expect(await d.findByText(/Choose one up to 5 MB/)).toBeTruthy()
    expect(createBanner).not.toHaveBeenCalled()
  })

  it('R-85: the name field allows at most 60 characters', async () => {
    vi.mocked(listBanners).mockResolvedValue({ items: [] })
    const user = renderAt('/banners')
    await screen.findByText('No banners yet')
    const d = await openUpload(user)
    await user.type(d.getByLabelText(/Banner name/), 'x'.repeat(70))
    expect((d.getByLabelText(/Banner name/) as HTMLInputElement).value).toHaveLength(60)
  })

  it('R-85: server field errors show under the same fields and nothing typed is lost', async () => {
    vi.mocked(listBanners).mockResolvedValue({ items: [] })
    vi.mocked(createBanner).mockRejectedValue(
      new ApiError(422, 'Invalid', 'validation_error', { name: 'You already have a banner with this name.', image: 'This image is not valid.' }),
    )
    const user = renderAt('/banners')
    await screen.findByText('No banners yet')
    const d = await openUpload(user)
    await user.type(d.getByLabelText(/Banner name/), 'Shop logo')
    await user.upload(d.getByLabelText(/Banner image/), png())
    await user.click(d.getByRole('button', { name: 'Upload banner' }))
    expect(await d.findByText('You already have a banner with this name.')).toBeTruthy()
    expect(d.getByText('This image is not valid.')).toBeTruthy()
    expect((d.getByLabelText(/Banner name/) as HTMLInputElement).value).toBe('Shop logo')
  })

  it('R-85: the upload button is busy while the request runs', async () => {
    vi.mocked(listBanners).mockResolvedValue({ items: [] })
    vi.mocked(createBanner).mockReturnValue(new Promise(() => {}))
    const user = renderAt('/banners')
    await screen.findByText('No banners yet')
    const d = await openUpload(user)
    await user.type(d.getByLabelText(/Banner name/), 'Shop logo')
    await user.upload(d.getByLabelText(/Banner image/), png())
    await user.click(d.getByRole('button', { name: 'Upload banner' }))
    expect((await d.findByRole('button', { name: 'Uploading…' })).getAttribute('aria-busy')).toBe('true')
  })

  it('R-85: delete asks first, says past videos are not affected, then removes and refreshes', async () => {
    vi.mocked(listBanners).mockResolvedValueOnce({ items: [banner(1)] }).mockResolvedValue({ items: [] })
    vi.mocked(deleteBanner).mockResolvedValue(undefined)
    const user = renderAt('/banners')
    await user.click(await screen.findByRole('button', { name: 'Delete banner: Banner 1' }))
    const d = within(await screen.findByRole('dialog'))
    expect(d.getByText(/Videos you already made are not affected/)).toBeTruthy()
    expect(deleteBanner).not.toHaveBeenCalled()
    await user.click(d.getByRole('button', { name: 'Delete banner' }))
    expect(deleteBanner).toHaveBeenCalledWith('b1')
    expect(await screen.findByText('No banners yet')).toBeTruthy()
  })

  it('R-85: Keep banner closes the confirmation without deleting', async () => {
    vi.mocked(listBanners).mockResolvedValue({ items: [banner(1)] })
    const user = renderAt('/banners')
    await user.click(await screen.findByRole('button', { name: 'Delete banner: Banner 1' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep banner' }))
    expect(deleteBanner).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('R-85: a failed delete says the banner is still saved', async () => {
    vi.mocked(listBanners).mockResolvedValue({ items: [banner(1)] })
    vi.mocked(deleteBanner).mockRejectedValue(new ApiError(500, 'Server broke', 'server_error'))
    const user = renderAt('/banners')
    await user.click(await screen.findByRole('button', { name: 'Delete banner: Banner 1' }))
    const d = within(await screen.findByRole('dialog'))
    await user.click(d.getByRole('button', { name: 'Delete banner' }))
    expect(await d.findByText(/Server broke The banner is still saved\./)).toBeTruthy()
  })
})
