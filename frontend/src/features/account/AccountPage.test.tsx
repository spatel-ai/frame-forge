import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, changePassword, getConfig, getMe, logout, logoutAll, NetworkError, resendVerification } from '../../api/client'
import type { Config, User } from '../../api/client'
import { createQueryClient } from '../../lib/session'
import { routes } from '../../routes'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getConfig: vi.fn(),
  getMe: vi.fn(),
  changePassword: vi.fn(),
  logout: vi.fn(),
  logoutAll: vi.fn(),
  resendVerification: vi.fn(),
}))

const KEY = 'talking-avatar-job-id'
const asha = (extra: Partial<User> = {}) =>
  ({ id: 'u1', name: 'Asha Verma', email: 'asha@example.com', email_verified: true, role: 'user', active_sessions: 1, ...extra }) as User
const config = { provider: 'mock', max_audio_seconds: 60, max_script_chars: 100, max_image_mb: 1, languages: ['English'], credits_per_second: 20, voice_price_credits: 10 } as Config

let router: ReturnType<typeof createMemoryRouter>
function renderAccount(me: User | null = asha(), path = '/account') {
  if (me) vi.mocked(getMe).mockResolvedValue(me)
  else vi.mocked(getMe).mockRejectedValue(new ApiError(401, 'Not logged in', 'not_authenticated'))
  const queryClient = createQueryClient(() => router)
  router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { queryClient, user: userEvent.setup() }
}
const where = () => router.state.location.pathname

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  vi.mocked(getConfig).mockResolvedValue(config)
})

const fill = async (user: ReturnType<typeof userEvent.setup>, cur: string, next: string, confirm: string) => {
  await user.type(await screen.findByLabelText('Current password'), cur)
  await user.type(screen.getByLabelText('New password'), next)
  await user.type(screen.getByLabelText('Confirm new password'), confirm)
}
const save = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Save new password' }))

describe('profile', () => {
  it('R-01 shows name, email and Verified for a confirmed user', async () => {
    renderAccount()
    expect(await screen.findByRole('heading', { level: 1, name: 'Account' })).toBeTruthy()
    expect(screen.getByText('Asha Verma', { selector: 'dd' })).toBeTruthy()
    expect(screen.getByText('asha@example.com')).toBeTruthy()
    expect(screen.getByText('Verified')).toBeTruthy()
    expect(screen.queryByText('Not confirmed')).toBeNull()
  })

  it('R-01 shows Not confirmed and a resend action for an unconfirmed user', async () => {
    renderAccount(asha({ email_verified: false }))
    expect(await screen.findByText('Not confirmed')).toBeTruthy()
    expect(screen.queryByText('Verified')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send the link again' })).toBeTruthy()
  })

  it('R-01 resend is busy, then says the link was sent', async () => {
    let done: () => void = () => {}
    vi.mocked(resendVerification).mockReturnValue(new Promise<void>((r) => (done = r)))
    const { user } = renderAccount(asha({ email_verified: false }))
    await user.click(await screen.findByRole('button', { name: 'Send the link again' }))
    expect(screen.getByRole('button', { name: 'Sending…' }).getAttribute('aria-busy')).toBe('true')
    await act(async () => done())
    expect(await screen.findByText('The link was sent again. Check your inbox.')).toBeTruthy()
  })

  it('R-01 resend shows the server detail on 429', async () => {
    vi.mocked(resendVerification).mockRejectedValue(new ApiError(429, 'Try again in 60 seconds.', 'rate_limited'))
    const { user } = renderAccount(asha({ email_verified: false }))
    await user.click(await screen.findByRole('button', { name: 'Send the link again' }))
    expect(await screen.findByText('Try again in 60 seconds.')).toBeTruthy()
  })
})

describe('change password', () => {
  it('R-01 validates on submit without calling the server', async () => {
    const { user } = renderAccount()
    await screen.findByLabelText('Current password')
    expect(screen.getByText('At least 10 characters.')).toBeTruthy()
    await save(user)
    expect(await screen.findByText('Enter your password.')).toBeTruthy()
    expect(screen.getByText('Use at least 10 characters.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Current password'))
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('R-01 shows the mismatch under the confirm field', async () => {
    const { user } = renderAccount()
    await fill(user, 'old-password-1', 'new-password-12', 'new-password-99')
    await save(user)
    expect(await screen.findByText('The two passwords are different. Type the same password in both boxes.')).toBeTruthy()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('R-01 shows the server current_password error under its field and keeps what was typed', async () => {
    vi.mocked(changePassword).mockRejectedValue(
      new ApiError(422, 'Check the form.', 'validation_error', { current_password: 'That is not your current password.' }),
    )
    const { user } = renderAccount()
    await fill(user, 'wrong-password', 'new-password-12', 'new-password-12')
    await save(user)
    expect(await screen.findByText('That is not your current password.')).toBeTruthy()
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('new-password-12')
    expect(changePassword).toHaveBeenCalledWith('wrong-password', 'new-password-12')
  })

  it('R-01 shows the server new_password error under its field', async () => {
    vi.mocked(changePassword).mockRejectedValue(
      new ApiError(422, 'Check the form.', 'validation_error', { new_password: 'Choose a different password.' }),
    )
    const { user } = renderAccount()
    await fill(user, 'old-password-1', 'new-password-12', 'new-password-12')
    await save(user)
    expect(await screen.findByText('Choose a different password.')).toBeTruthy()
  })

  it('R-01 success clears the form, shows the Banner and refetches me', async () => {
    vi.mocked(changePassword).mockResolvedValue(undefined)
    const { user } = renderAccount()
    await fill(user, 'old-password-1', 'new-password-12', 'new-password-12')
    expect(getMe).toHaveBeenCalledTimes(1)
    vi.mocked(getMe).mockResolvedValue(asha({ active_sessions: 1 }))
    await save(user)
    expect(await screen.findByText('Password changed. Your other devices were logged out.')).toBeTruthy()
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Confirm new password') as HTMLInputElement).value).toBe('')
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2))
  })

  it('R-01 the button is busy and a second click does not submit again', async () => {
    let done: () => void = () => {}
    vi.mocked(changePassword).mockReturnValue(new Promise<void>((r) => (done = r)))
    const { user } = renderAccount()
    await fill(user, 'old-password-1', 'new-password-12', 'new-password-12')
    await save(user)
    const busy = screen.getByRole('button', { name: 'Saving…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    await user.click(busy)
    expect(changePassword).toHaveBeenCalledTimes(1)
    await act(async () => done())
  })
})

describe('sessions', () => {
  it('R-01 says "1 device" in the singular', async () => {
    renderAccount(asha({ active_sessions: 1 }))
    expect(await screen.findByText('You are logged in on 1 device.')).toBeTruthy()
  })

  it('R-01 says "3 devices" in the plural', async () => {
    renderAccount(asha({ active_sessions: 3 }))
    expect(await screen.findByText('You are logged in on 3 devices.')).toBeTruthy()
  })

  it('R-01 Cancel closes the log out everywhere dialog without a call', async () => {
    const { user } = renderAccount()
    await user.click(await screen.findByRole('button', { name: 'Log out everywhere' }))
    const dialog = await screen.findByRole('dialog', { name: 'Log out everywhere?' })
    expect(within(dialog).getByText('You will need to log in again on every device, including this one.')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(logoutAll).not.toHaveBeenCalled()
    expect(where()).toBe('/account')
  })

  it('R-01 confirming calls logoutAll, clears the session state and goes to /login', async () => {
    localStorage.setItem(KEY, 'job-1')
    vi.mocked(logoutAll).mockResolvedValue(undefined)
    const { user, queryClient } = renderAccount()
    queryClient.setQueryData(['job', 'job-1'], { id: 'job-1' })
    await user.click(await screen.findByRole('button', { name: 'Log out everywhere' }))
    const dialog = await screen.findByRole('dialog', { name: 'Log out everywhere?' })
    await user.click(within(dialog).getByRole('button', { name: 'Log out everywhere' }))
    await waitFor(() => expect(where()).toBe('/login'))
    expect(logoutAll).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(queryClient.getQueryData(['job', 'job-1'])).toBeUndefined()
  })

  it('R-01 a network error on log out everywhere shows a Banner and stays', async () => {
    vi.mocked(logoutAll).mockRejectedValue(new NetworkError())
    const { user } = renderAccount()
    await user.click(await screen.findByRole('button', { name: 'Log out everywhere' }))
    const dialog = await screen.findByRole('dialog', { name: 'Log out everywhere?' })
    await user.click(within(dialog).getByRole('button', { name: 'Log out everywhere' }))
    expect(await screen.findByText('We could not reach the server. Check your connection and try again.')).toBeTruthy()
    expect(where()).toBe('/account')
  })
})

describe('log out', () => {
  it('R-01 calls logout, clears the session state and goes to /login', async () => {
    localStorage.setItem(KEY, 'job-1')
    vi.mocked(logout).mockResolvedValue(undefined)
    const { user, queryClient } = renderAccount()
    queryClient.setQueryData(['job', 'job-1'], { id: 'job-1' })
    await user.click(await screen.findByRole('button', { name: 'Log out' }))
    await waitFor(() => expect(where()).toBe('/login'))
    expect(logout).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(queryClient.getQueryData(['job', 'job-1'])).toBeUndefined()
  })

  it('R-01 a network error on log out shows a Banner and stays', async () => {
    vi.mocked(logout).mockRejectedValue(new NetworkError())
    const { user } = renderAccount()
    await user.click(await screen.findByRole('button', { name: 'Log out' }))
    expect(await screen.findByText('We could not reach the server. Check your connection and try again.')).toBeTruthy()
    expect(where()).toBe('/account')
  })
})

describe('navigation', () => {
  it('R-01 the Account nav item is present and current on /account', async () => {
    renderAccount()
    await screen.findByRole('heading', { level: 1, name: 'Account' })
    const links = screen.getAllByRole('link', { name: 'Account' })
    expect(links.length).toBeGreaterThan(0)
    expect(links.some((l) => l.getAttribute('aria-current') === 'page')).toBe(true)
  })

  it('R-01 /account redirects to log in when logged out', async () => {
    renderAccount(null)
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy()
    expect(router.state.location.pathname + router.state.location.search).toBe('/login?next=%2Faccount')
  })
})
