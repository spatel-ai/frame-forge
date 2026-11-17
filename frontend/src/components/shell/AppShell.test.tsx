import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig, getMe } from '../../api/client'
import type { Config, User } from '../../api/client'
import AppShell from '../AppShell'
import NotFound from '../NotFound'
import { enabledNavItems, navItems } from './navItems'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfig: vi.fn(),
  getMe: vi.fn(),
}))

const user = { id: 'u1', name: 'Asha Verma', email: 'asha@example.com', email_verified: true, role: 'user', active_sessions: 1 } as User

const config = (provider: string): Config => ({
  provider,
  max_audio_seconds: 60,
  max_script_chars: 100,
  max_image_mb: 1,
  languages: ['English'],
  credits_per_second: 20, voice_price_credits: 10,
}) as Config

function renderAt(path: string, provider = 'mock') {
  vi.mocked(getConfig).mockResolvedValue(config(provider))
  const router = createMemoryRouter(
    [{
      path: '/',
      element: <AppShell />,
      children: [
        { path: 'create', element: <p>create page</p> },
        { path: 'create/:jobId', element: <p>job page</p> },
        { path: '*', element: <NotFound /> },
      ],
    }],
    { initialEntries: [path] },
  )
  const client = new QueryClient()
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}

beforeEach(() => {
  vi.mocked(getConfig).mockReset()
  vi.mocked(getMe).mockReset()
  vi.mocked(getMe).mockResolvedValue(user)
})

describe('AppShell', () => {
  it('R-01 shows the logged-in user name in the top bar', async () => {
    renderAt('/create')
    const bar = screen.getByRole('banner')
    expect(await within(bar).findByText('Asha Verma')).toBeTruthy()
  })

  it('R-76 renders only enabled items in the sidebar, and five entries in the phone bar', async () => {
    renderAt('/create')
    const side = screen.getByRole('navigation', { name: 'Main' })
    expect(within(side).getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'Create', 'Videos', 'Scripts', 'Banners', 'Wallet', 'Account'])
    const phone = screen.getByRole('navigation', { name: 'Main (phone)' })
    expect(within(phone).getAllByRole('link').map((a) => a.textContent)).toEqual(['Home', 'Create', 'Videos', 'Wallet'])
    expect(within(phone).getByRole('button', { name: 'More' })).toBeTruthy()
    expect(screen.queryByText(/coming soon/i)).toBeNull()
    await screen.findByText(/Mock mode/)
  })

  it('R-88 More opens a sheet with Scripts, Banners and Account, and choosing one closes it', async () => {
    renderAt('/create')
    const phone = screen.getByRole('navigation', { name: 'Main (phone)' })
    const more = within(phone).getByRole('button', { name: 'More' })
    expect(more.getAttribute('aria-haspopup')).toBe('dialog')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    const sheet = await screen.findByRole('dialog', { name: 'More' })
    expect(within(sheet).getAllByRole('link').map((a) => a.textContent)).toEqual(['Scripts', 'Banners', 'Account'])
    await userEvent.click(within(sheet).getByRole('link', { name: 'Banners' }))
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull()
    expect(more.getAttribute('aria-expanded')).toBe('false')
  })

  it('R-88 the More sheet closes on Escape and focus returns to the More button', async () => {
    renderAt('/create')
    const more = within(screen.getByRole('navigation', { name: 'Main (phone)' })).getByRole('button', { name: 'More' })
    more.focus()
    await userEvent.click(more)
    const sheet = await screen.findByRole('dialog', { name: 'More' })
    // jsdom does not turn Escape into the native cancel event; the shared Dialog test dispatches it the same way.
    act(() => { sheet.dispatchEvent(new Event('cancel', { cancelable: true })) })
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull()
    expect(document.activeElement).toBe(more)
  })

  it('R-88 More is current only when the route is one of its items', async () => {
    const { unmount } = renderAt('/create')
    const phone = () => screen.getByRole('navigation', { name: 'Main (phone)' })
    expect(within(phone()).getByRole('button', { name: 'More' }).className).not.toMatch(/active/)
    unmount()
    renderAt('/account/security')
    await screen.findByRole('heading', { name: 'Page not found' })
    expect(within(phone()).getByRole('button', { name: 'More' }).className).toMatch(/active/)
  })

  it('R-88 flags exactly Home, Create, Videos and Wallet for the phone bar', () => {
    expect(enabledNavItems().filter((i) => i.phonePrimary).map((i) => i.label)).toEqual(['Home', 'Create', 'Videos', 'Wallet'])
  })

  it('R-76 keeps the switched-off items in the data, with Home, Create, Videos, Scripts, Banners, Wallet and Account enabled', () => {
    expect(navItems.map((i) => i.label)).toEqual(['Home', 'Create', 'Videos', 'Scripts', 'Banners', 'Wallet', 'Account'])
    expect(enabledNavItems().map((i) => i.label)).toEqual(['Home', 'Create', 'Videos', 'Scripts', 'Banners', 'Wallet', 'Account'])
  })

  it('R-76 marks Create as the current page on /create/abc', async () => {
    renderAt('/create/abc')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Create' }).getAttribute('aria-current')).toBe('page')
    await screen.findByText(/Mock mode/)
  })

  it('R-77 shows the mock badge only for the mock provider', async () => {
    const { unmount } = renderAt('/create', 'mock')
    expect(await screen.findByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Mock mode — no real generation, no cost')).toBeTruthy()
    unmount()
    renderAt('/create', 'fal')
    await vi.waitFor(() => expect(getConfig).toHaveBeenCalled())
    await screen.findByText('create page')
    expect(screen.queryByText(/Mock mode/)).toBeNull()
  })

  it('R-77 with mock video but Razorpay payments, the badge does not claim "no cost"', async () => {
    vi.mocked(getConfig).mockResolvedValueOnce({ ...(await getConfig()), provider: 'mock', payments: 'razorpay' })
    renderAt('/create', 'mock')
    expect(await screen.findByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Mock video — payments go through Razorpay')).toBeTruthy()
    expect(screen.queryByText(/no cost/)).toBeNull()
  })

  it('R-77 keeps the AI-generated and consent notice', () => {
    renderAt('/create')
    expect(screen.getByText(/The output is AI-generated/)).toBeTruthy()
    expect(screen.getByText(/someone who has agreed/)).toBeTruthy()
  })

  it('R-77 skip link is the first focusable element and targets the only main', async () => {
    renderAt('/create')
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(skip.getAttribute('href')).toBe('#content')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main').id).toBe('content')
    await userEvent.tab()
    expect(document.activeElement).toBe(skip)
  })

  it('R-77 not-found page links back to Create', async () => {
    renderAt('/nowhere')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to Create' }).getAttribute('href')).toBe('/create')
  })

  describe('bottom-bar scroll helper (phones)', () => {
    const original = { matchMedia: window.matchMedia, rect: HTMLElement.prototype.getBoundingClientRect, raf: window.requestAnimationFrame }
    afterEach(() => {
      window.matchMedia = original.matchMedia
      HTMLElement.prototype.getBoundingClientRect = original.rect
      window.requestAnimationFrame = original.raf
    })
    function phoneWithButtonUnderBar() {
      window.matchMedia = ((q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
      window.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0 }) as typeof window.requestAnimationFrame
      HTMLElement.prototype.getBoundingClientRect = () => ({ top: 700, bottom: 790, left: 0, right: 100, width: 100, height: 90, x: 0, y: 700, toJSON() {} }) as DOMRect
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      return scroll
    }

    it('does not scroll when focus comes from a tap or click', async () => {
      const scroll = phoneWithButtonUnderBar()
      renderAt('/create')
      await screen.findByText('create page')
      const target = document.createElement('button')
      document.body.append(target)
      target.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      target.focus()
      expect(scroll).not.toHaveBeenCalled()
      target.remove()
    })

    it('does not scroll the content region itself, even after a key press', async () => {
      const scroll = phoneWithButtonUnderBar()
      renderAt('/create')
      await screen.findByText('create page')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      screen.getByRole('main').focus()
      expect(scroll).not.toHaveBeenCalled()
    })

    it('scrolls a keyboard-focused control that is under the bottom bar', async () => {
      const scroll = phoneWithButtonUnderBar()
      renderAt('/create')
      await screen.findByText('create page')
      const target = document.createElement('button')
      document.body.append(target)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      target.focus()
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
      target.remove()
    })
  })
})
