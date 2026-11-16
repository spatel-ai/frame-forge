import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, login, meKey, signup } from '../../api/client'
import { safeNext } from './validation'
import { at, renderAuth, testUser } from './testUtils'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  login: vi.fn(),
  signup: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
})

const emailBox = () => screen.getByLabelText('Email') as HTMLInputElement
const passwordBox = () => screen.getByLabelText('Password') as HTMLInputElement

describe('Log in (R-01)', () => {
  it('R-01 logs in, puts the user in the cache under meKey and goes to /create', async () => {
    vi.mocked(login).mockResolvedValue(testUser)
    const { u, router, queryClient } = renderAuth('/login')
    await u.type(emailBox(), 'asha@example.com')
    await u.type(passwordBox(), 'Diwali2026!')
    await u.click(screen.getByRole('button', { name: 'Log in' }))
    await waitFor(() => expect(at(router)).toBe('/create'))
    expect(login).toHaveBeenCalledWith('asha@example.com', 'Diwali2026!')
    expect(queryClient.getQueryData(meKey)).toEqual(testUser)
  })

  it('R-01 goes to a safe next path and ignores off-site ones', async () => {
    vi.mocked(login).mockResolvedValue(testUser)
    const first = renderAuth('/login?next=/videos')
    await first.u.type(emailBox(), 'a@b.co')
    await first.u.type(passwordBox(), 'x')
    await first.u.click(screen.getByRole('button', { name: 'Log in' }))
    await waitFor(() => expect(at(first.router)).toBe('/videos'))
  })

  it('R-01 safeNext accepts one leading slash only', () => {
    expect(safeNext('/videos/1?x=2')).toBe('/videos/1?x=2')
    expect(safeNext('//evil.example')).toBe('/create')
    expect(safeNext('/\\evil.example')).toBe('/create')
    expect(safeNext('https://evil.example')).toBe('/create')
    expect(safeNext('evil')).toBe('/create')
    expect(safeNext(null)).toBe('/create')
  })

  it('R-01 does not redirect off-site when next is //host', async () => {
    vi.mocked(login).mockResolvedValue(testUser)
    const { u, router } = renderAuth('/login?next=//evil.example')
    await u.type(emailBox(), 'a@b.co')
    await u.type(passwordBox(), 'x')
    await u.click(screen.getByRole('button', { name: 'Log in' }))
    await waitFor(() => expect(at(router)).toBe('/create'))
  })

  it('R-01 shows a danger banner on invalid_credentials and keeps email and password', async () => {
    vi.mocked(login).mockRejectedValue(new ApiError(401, 'nope', 'invalid_credentials'))
    const { u } = renderAuth('/login')
    await u.type(emailBox(), 'asha@example.com')
    await u.type(passwordBox(), 'wrong-password')
    await u.click(screen.getByRole('button', { name: 'Log in' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Email or password is wrong.')
    expect(emailBox().value).toBe('asha@example.com')
    expect(passwordBox().value).toBe('wrong-password')
  })

  it('R-01 shows the server detail on rate_limited', async () => {
    vi.mocked(login).mockRejectedValue(new ApiError(429, 'Too many tries. Wait 5 minutes.', 'rate_limited'))
    const { u } = renderAuth('/login')
    await u.type(emailBox(), 'asha@example.com')
    await u.type(passwordBox(), 'x')
    await u.click(screen.getByRole('button', { name: 'Log in' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Too many tries. Wait 5 minutes.')
  })

  it('R-01 validates on blur, then live, and focuses the first invalid field on submit', async () => {
    const { u } = renderAuth('/login')
    await u.type(emailBox(), 'asha@example')
    await u.tab()
    expect(screen.getByText('Enter a full email address, like name@example.com.')).toBeTruthy()
    await u.type(emailBox(), '.com')
    expect(screen.queryByText('Enter a full email address, like name@example.com.')).toBeNull()
    await u.clear(emailBox())
    expect(screen.getByText('Enter a full email address, like name@example.com.')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Log in' }))
    expect(document.activeElement).toBe(emailBox())
    expect(screen.getByText('Enter your password.')).toBeTruthy()
    expect(login).not.toHaveBeenCalled()
  })

  it('R-01 is busy while the request runs and cannot be submitted twice', async () => {
    let finish: (u: typeof testUser) => void = () => {}
    vi.mocked(login).mockReturnValue(new Promise((r) => (finish = r)))
    const { u, router } = renderAuth('/login')
    await u.type(emailBox(), 'asha@example.com')
    await u.type(passwordBox(), 'Diwali2026!')
    const button = screen.getByRole('button', { name: 'Log in' })
    await u.click(button)
    await u.click(button)
    await u.type(passwordBox(), '{Enter}')
    expect(login).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /logging in/i }).getAttribute('aria-busy')).toBe('true')
    await act(async () => finish(testUser))
    await waitFor(() => expect(at(router)).toBe('/create'))
  })

  it('R-01 shows and hides the password, and links to sign up and forgot password', async () => {
    const { u } = renderAuth('/login')
    await u.type(passwordBox(), 'abc')
    await u.click(screen.getByRole('button', { name: 'Show password' }))
    expect(passwordBox().type).toBe('text')
    expect(screen.getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe('/forgot-password')
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/signup')
    expect(screen.getByText('Videos made here are AI-generated.')).toBeTruthy()
    expect(screen.getByText('Your photo. Your script. A talking video.')).toBeTruthy()
  })
})

describe('Sign up (R-01)', () => {
  const nameBox = () => screen.getByLabelText('Name') as HTMLInputElement

  it('R-01 creates the account, caches the user and goes to /create', async () => {
    vi.mocked(signup).mockResolvedValue(testUser)
    const { u, router, queryClient } = renderAuth('/signup')
    await u.type(nameBox(), 'Asha Verma')
    await u.type(emailBox(), 'asha@example.com')
    await u.type(passwordBox(), 'Diwali2026!')
    await u.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(at(router)).toBe('/create'))
    expect(signup).toHaveBeenCalledWith('Asha Verma', 'asha@example.com', 'Diwali2026!')
    expect(queryClient.getQueryData(meKey)).toEqual(testUser)
  })

  it('R-01 shows the hint and the confirm line, and has no Terms checkbox', () => {
    renderAuth('/signup')
    expect(screen.getByText('At least 10 characters')).toBeTruthy()
    expect(screen.getByText('We will email you a link to confirm your address.')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login')
  })

  it('R-01 validates name, email and password on blur and focuses the first invalid field on submit', async () => {
    const { u } = renderAuth('/signup')
    await u.type(nameBox(), 'Asha')
    await u.tab()
    expect(screen.getByText('Looks good')).toBeTruthy()
    await u.type(emailBox(), 'asha@example')
    await u.tab()
    await u.type(passwordBox(), 'short')
    await u.tab()
    expect(screen.getByText('Enter a full email address, like name@example.com.')).toBeTruthy()
    expect(screen.getByText('Use at least 10 characters.')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Create account' }))
    expect(document.activeElement).toBe(emailBox())
    expect(signup).not.toHaveBeenCalled()
  })

  it('R-01 rejects a name over 80 characters and a password over 128', async () => {
    const { u } = renderAuth('/signup')
    await u.click(nameBox())
    await u.paste('n'.repeat(81))
    await u.tab()
    expect(screen.getByText('Use 80 characters or fewer.')).toBeTruthy()
    await u.click(passwordBox())
    await u.paste('p'.repeat(129))
    await u.tab()
    expect(screen.getByText('Use 128 characters or fewer.')).toBeTruthy()
  })

  it('R-01 shows email_taken under the email with links to log in and forgot password', async () => {
    vi.mocked(signup).mockRejectedValue(new ApiError(409, 'An account with this email already exists.', 'email_taken'))
    const { u } = renderAuth('/signup')
    await u.type(nameBox(), 'Asha')
    await u.type(emailBox(), 'asha@example.com')
    await u.type(passwordBox(), 'Diwali2026!')
    await u.click(screen.getByRole('button', { name: 'Create account' }))
    expect((await screen.findByRole('alert')).textContent).toContain('An account with this email already exists.')
    expect(emailBox().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(emailBox())
    const links = screen.getAllByRole('link').map((l) => l.getAttribute('href'))
    expect(links).toContain('/forgot-password')
    expect(screen.getByRole('link', { name: 'reset your password' })).toBeTruthy()
    expect(nameBox().value).toBe('Asha')
    expect(passwordBox().value).toBe('Diwali2026!')
  })

  it('R-01 shows server field errors under name, email and password', async () => {
    vi.mocked(signup).mockRejectedValue(
      new ApiError(422, 'Check the form.', 'validation_error', { password: 'That password is too common.' }),
    )
    const { u } = renderAuth('/signup')
    await u.type(nameBox(), 'Asha')
    await u.type(emailBox(), 'asha@example.com')
    await u.type(passwordBox(), 'password12345')
    await u.click(screen.getByRole('button', { name: 'Create account' }))
    expect((await screen.findByRole('alert')).textContent).toContain('That password is too common.')
    expect(document.activeElement).toBe(passwordBox())
  })

  it('R-01 shows the server detail on rate_limited', async () => {
    vi.mocked(signup).mockRejectedValue(new ApiError(429, 'Too many sign-ups. Try later.', 'rate_limited'))
    const { u } = renderAuth('/signup')
    await u.type(nameBox(), 'Asha')
    await u.type(emailBox(), 'asha@example.com')
    await u.type(passwordBox(), 'Diwali2026!')
    await u.click(screen.getByRole('button', { name: 'Create account' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Too many sign-ups. Try later.')
  })

  it('R-01 is busy while signing up and cannot be double-submitted', async () => {
    let finish: (u: typeof testUser) => void = () => {}
    vi.mocked(signup).mockReturnValue(new Promise((r) => (finish = r)))
    const { u, router } = renderAuth('/signup')
    await u.type(nameBox(), 'Asha')
    await u.type(emailBox(), 'asha@example.com')
    await u.type(passwordBox(), 'Diwali2026!')
    const button = screen.getByRole('button', { name: 'Create account' })
    await u.click(button)
    await u.click(button)
    expect(signup).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /creating account/i }).getAttribute('aria-busy')).toBe('true')
    await act(async () => finish(testUser))
    await waitFor(() => expect(at(router)).toBe('/create'))
  })
})
