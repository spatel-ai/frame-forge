import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('R-76 renders only enabled items in the sidebar and the phone bar', async () => {
    renderAt('/create')
    for (const name of ['Main', 'Main (phone)']) {
      const nav = screen.getByRole('navigation', { name })
      expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Create', 'Wallet', 'Account'])
    }
    expect(screen.queryByText('Home')).toBeNull()
    expect(screen.queryByText(/coming soon/i)).toBeNull()
    await screen.findByText(/Mock mode/)
  })

  it('R-76 keeps the switched-off items in the data, with Create, Wallet and Account enabled', () => {
    expect(navItems.map((i) => i.label)).toEqual(['Home', 'Create', 'Videos', 'Scripts', 'Wallet', 'Account'])
    expect(enabledNavItems().map((i) => i.label)).toEqual(['Create', 'Wallet', 'Account'])
  })

  it('R-76 marks Create as the current page on /create/abc', async () => {
    renderAt('/create/abc')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Create' }).getAttribute('aria-current')).toBe('page')
    await screen.findByText(/Mock mode/)
  })

  it('R-77 shows the mock badge only for the mock provider', async () => {
    const { unmount } = renderAt('/create', 'mock')
    expect(await screen.findByText('Mock mode — no real generation, no cost')).toBeTruthy()
    unmount()
    renderAt('/create', 'fal')
    await vi.waitFor(() => expect(getConfig).toHaveBeenCalled())
    await screen.findByText('create page')
    expect(screen.queryByText(/Mock mode/)).toBeNull()
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
})
