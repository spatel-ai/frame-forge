import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  checkResetToken,
  forgotPassword,
  meKey,
  resendVerification,
  resetPassword,
  verifyEmail,
} from '../../api/client'
import { at, renderAuth, testUser } from './testUtils'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  forgotPassword: vi.fn(),
  checkResetToken: vi.fn(),
  resetPassword: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerification: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('Forgot password (R-01)', () => {
  it('R-01 sends the link and shows the email that was entered', async () => {
    vi.mocked(forgotPassword).mockResolvedValue(undefined)
    const { u, router } = renderAuth('/forgot-password')
    await u.type(screen.getByLabelText('Email'), 'asha@example.com')
    await u.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(at(router)).toBe('/forgot-password/sent'))
    expect(forgotPassword).toHaveBeenCalledWith('asha@example.com')
    // The router reports the new location a tick before the new screen renders; wait for it.
    expect(await screen.findByText('Check your email')).toBeTruthy()
    expect(screen.getByText('asha@example.com')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to log in' }).getAttribute('href')).toBe('/login')
  })

  it('R-01 validates the email on blur and submit and focuses it', async () => {
    const { u } = renderAuth('/forgot-password')
    const box = screen.getByLabelText('Email')
    await u.type(box, 'nope')
    await u.tab()
    expect(screen.getByText('Enter a full email address, like name@example.com.')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(document.activeElement).toBe(box)
    expect(forgotPassword).not.toHaveBeenCalled()
  })

  it('R-01 shows the server detail on rate_limited and keeps the email', async () => {
    vi.mocked(forgotPassword).mockRejectedValue(new ApiError(429, 'Wait a minute before asking again.', 'rate_limited'))
    const { u } = renderAuth('/forgot-password')
    await u.type(screen.getByLabelText('Email'), 'asha@example.com')
    await u.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Wait a minute before asking again.')
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('asha@example.com')
  })

  it('R-01 is busy while sending and cannot be double-submitted', async () => {
    let finish: () => void = () => {}
    vi.mocked(forgotPassword).mockReturnValue(new Promise<void>((r) => (finish = r)))
    const { u } = renderAuth('/forgot-password')
    await u.type(screen.getByLabelText('Email'), 'asha@example.com')
    const button = screen.getByRole('button', { name: 'Send reset link' })
    await u.click(button)
    await u.click(button)
    expect(forgotPassword).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /sending/i }).getAttribute('aria-busy')).toBe('true')
    await act(async () => finish())
  })
})

describe('Check your email (R-01)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('R-01 goes back to the form when opened without an email', async () => {
    const { router } = renderAuth('/forgot-password/sent')
    await waitFor(() => expect(at(router)).toBe('/forgot-password'))
  })

  it('R-01 locks Resend for 60 seconds, then sends again and locks again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    vi.mocked(forgotPassword).mockResolvedValue(undefined)
    renderAuth({ pathname: '/forgot-password/sent', state: { email: 'asha@example.com' } })
    const locked = screen.getByRole('button', { name: 'Resend link in 1:00' }) as HTMLButtonElement
    expect(locked.disabled).toBe(true)
    for (let i = 0; i < 8; i++) await act(async () => vi.advanceTimersByTime(1000))
    expect((screen.getByRole('button', { name: 'Resend link in 0:52' }) as HTMLButtonElement).disabled).toBe(true)
    for (let i = 0; i < 52; i++) await act(async () => vi.advanceTimersByTime(1000))
    const ready = screen.getByRole('button', { name: 'Resend link' }) as HTMLButtonElement
    expect(ready.disabled).toBe(false)
    await act(async () => {
      ready.click()
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(forgotPassword).toHaveBeenCalledWith('asha@example.com')
    expect(screen.getByText('We sent another link.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Resend link in 1:00' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Set a new password (R-01)', () => {
  const start = (opts?: { strict?: boolean }) => {
    window.history.replaceState(null, '', '/reset-password?token=tok-123')
    return renderAuth('/reset-password?token=tok-123', opts)
  }
  const newBox = () => screen.getByLabelText('New password') as HTMLInputElement
  const againBox = () => screen.getByLabelText('Type it again') as HTMLInputElement

  it('R-01 removes the token from the address bar, keeps the path and checks the link once under StrictMode', async () => {
    vi.mocked(checkResetToken).mockResolvedValue({ email: 'asha@example.com' })
    start({ strict: true })
    expect(await screen.findByText('asha@example.com')).toBeTruthy()
    expect(window.location.pathname).toBe('/reset-password')
    expect(window.location.search).toBe('')
    expect(checkResetToken).toHaveBeenCalledTimes(1)
    expect(checkResetToken).toHaveBeenCalledWith('tok-123')
  })

  it('R-01 saves the new password with the token read at first render and goes to log in', async () => {
    vi.mocked(checkResetToken).mockResolvedValue({ email: 'asha@example.com' })
    vi.mocked(resetPassword).mockResolvedValue(undefined)
    const { u, router } = start()
    await screen.findByText('asha@example.com')
    expect(screen.getByText('After saving, you will be logged out on every device, then you can log in.')).toBeTruthy()
    await u.type(newBox(), 'Holi2026colours')
    await u.type(againBox(), 'Holi2026colours')
    await u.click(screen.getByRole('button', { name: 'Save new password' }))
    await waitFor(() => expect(at(router)).toBe('/login'))
    expect(resetPassword).toHaveBeenCalledWith('tok-123', 'Holi2026colours')
  })

  it('R-01 shows the mismatch message and focuses the first invalid field on submit', async () => {
    vi.mocked(checkResetToken).mockResolvedValue({ email: 'asha@example.com' })
    const { u } = start()
    await screen.findByText('asha@example.com')
    await u.type(newBox(), 'Holi2026colours')
    await u.type(againBox(), 'Holi2026colour')
    await u.tab()
    expect(screen.getByText('The two passwords are different. Type the same password in both boxes.')).toBeTruthy()
    await u.type(againBox(), 's')
    expect(screen.queryByText(/two passwords are different/)).toBeNull()
    await u.clear(newBox())
    await u.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(document.activeElement).toBe(newBox())
    expect(screen.getByText('Use at least 10 characters.')).toBeTruthy()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('R-01 shows the expired screen when the check answers reset_link_invalid', async () => {
    vi.mocked(checkResetToken).mockRejectedValue(new ApiError(400, 'bad', 'reset_link_invalid'))
    start()
    expect(await screen.findByText('This link has expired')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Send a new link' }).getAttribute('href')).toBe('/forgot-password')
    expect(screen.getByRole('link', { name: 'Back to log in' }).getAttribute('href')).toBe('/login')
  })

  it('R-01 shows the expired screen when the save answers reset_link_invalid', async () => {
    vi.mocked(checkResetToken).mockResolvedValue({ email: 'asha@example.com' })
    vi.mocked(resetPassword).mockRejectedValue(new ApiError(400, 'bad', 'reset_link_invalid'))
    const { u } = start()
    await screen.findByText('asha@example.com')
    await u.type(newBox(), 'Holi2026colours')
    await u.type(againBox(), 'Holi2026colours')
    await u.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByText('This link has expired')).toBeTruthy()
  })

  it('R-01 shows the expired screen when there is no token', () => {
    renderAuth('/reset-password')
    expect(screen.getByText('This link has expired')).toBeTruthy()
    expect(checkResetToken).not.toHaveBeenCalled()
  })

  it('R-01 shows server field errors and rate_limited on save', async () => {
    vi.mocked(checkResetToken).mockResolvedValue({ email: 'asha@example.com' })
    vi.mocked(resetPassword).mockRejectedValueOnce(
      new ApiError(422, 'Check the form.', 'validation_error', { password: 'That password is too common.' }),
    )
    vi.mocked(resetPassword).mockRejectedValueOnce(new ApiError(429, 'Slow down.', 'rate_limited'))
    const { u } = start()
    await screen.findByText('asha@example.com')
    await u.type(newBox(), 'password12345')
    await u.type(againBox(), 'password12345')
    await u.click(screen.getByRole('button', { name: 'Save new password' }))
    expect((await screen.findByRole('alert')).textContent).toContain('That password is too common.')
    expect(document.activeElement).toBe(newBox())
    await u.click(screen.getByRole('button', { name: 'Save new password' }))
    expect((await screen.findByText('Slow down.'))).toBeTruthy()
  })

  it('R-01 is busy while saving and cannot be double-submitted', async () => {
    vi.mocked(checkResetToken).mockResolvedValue({ email: 'asha@example.com' })
    let finish: () => void = () => {}
    vi.mocked(resetPassword).mockReturnValue(new Promise<void>((r) => (finish = r)))
    const { u } = start()
    await screen.findByText('asha@example.com')
    await u.type(newBox(), 'Holi2026colours')
    await u.type(againBox(), 'Holi2026colours')
    const button = screen.getByRole('button', { name: 'Save new password' })
    await u.click(button)
    await u.click(button)
    expect(resetPassword).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /saving/i }).getAttribute('aria-busy')).toBe('true')
    await act(async () => finish())
  })
})

describe('Confirm email (R-01)', () => {
  const start = (opts?: { strict?: boolean }) => {
    window.history.replaceState(null, '', '/verify-email?token=verify-1')
    return renderAuth('/verify-email?token=verify-1', opts)
  }

  it('R-01 calls verifyEmail exactly once under StrictMode and shows the confirmed screen', async () => {
    vi.mocked(verifyEmail).mockResolvedValue(undefined)
    start({ strict: true })
    expect(await screen.findByText('Your email is confirmed')).toBeTruthy()
    expect(verifyEmail).toHaveBeenCalledTimes(1)
    expect(verifyEmail).toHaveBeenCalledWith('verify-1')
    expect(window.location.search).toBe('')
    expect(screen.getByRole('link', { name: /Start creating/ }).getAttribute('href')).toBe('/create')
  })

  it('R-01 names the confirmed email when the user is in the cache', async () => {
    vi.mocked(verifyEmail).mockResolvedValue(undefined)
    window.history.replaceState(null, '', '/verify-email?token=verify-1')
    const { queryClient } = renderAuth('/verify-email?token=verify-1')
    queryClient.setQueryData(meKey, testUser)
    expect(await screen.findByText('Your email is confirmed')).toBeTruthy()
    expect(screen.getByText('asha@example.com')).toBeTruthy()
  })

  it('R-01 shows the expired screen on verify_link_invalid', async () => {
    vi.mocked(verifyEmail).mockRejectedValue(new ApiError(400, 'bad', 'verify_link_invalid'))
    start({ strict: true })
    expect(await screen.findByText('This link has expired')).toBeTruthy()
    expect(verifyEmail).toHaveBeenCalledTimes(1)
  })

  it('R-01 sends a new link from the expired screen', async () => {
    vi.mocked(verifyEmail).mockRejectedValue(new ApiError(400, 'bad', 'verify_link_invalid'))
    vi.mocked(resendVerification).mockResolvedValue(undefined)
    const { u } = start()
    await screen.findByText('This link has expired')
    await u.click(screen.getByRole('button', { name: 'Send a new link' }))
    expect(await screen.findByText('We sent a new link. Check your email.')).toBeTruthy()
    expect(resendVerification).toHaveBeenCalledTimes(1)
  })

  it('R-01 sends the person to log in with next=/create when resend answers 401', async () => {
    vi.mocked(verifyEmail).mockRejectedValue(new ApiError(400, 'bad', 'verify_link_invalid'))
    vi.mocked(resendVerification).mockRejectedValue(new ApiError(401, 'Log in first.', 'not_authenticated'))
    const { u, router } = start()
    await screen.findByText('This link has expired')
    await u.click(screen.getByRole('button', { name: 'Send a new link' }))
    await waitFor(() => expect(at(router)).toBe('/login?next=/create'))
    expect(router.state.location.search).toBe('?next=/create')
  })

  it('R-01 shows the server detail when resend is rate_limited', async () => {
    vi.mocked(verifyEmail).mockRejectedValue(new ApiError(400, 'bad', 'verify_link_invalid'))
    vi.mocked(resendVerification).mockRejectedValue(new ApiError(429, 'Wait before asking again.', 'rate_limited'))
    const { u } = start()
    await screen.findByText('This link has expired')
    await u.click(screen.getByRole('button', { name: 'Send a new link' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Wait before asking again.')
  })

  it('R-01 resend is busy and cannot be double-submitted', async () => {
    vi.mocked(verifyEmail).mockRejectedValue(new ApiError(400, 'bad', 'verify_link_invalid'))
    let finish: () => void = () => {}
    vi.mocked(resendVerification).mockReturnValue(new Promise<void>((r) => (finish = r)))
    const { u } = start()
    await screen.findByText('This link has expired')
    const button = screen.getByRole('button', { name: 'Send a new link' })
    await u.click(button)
    await u.click(button)
    expect(resendVerification).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /sending/i }).getAttribute('aria-busy')).toBe('true')
    await act(async () => finish())
  })

  it('R-01 shows the expired screen when there is no token', () => {
    renderAuth('/verify-email')
    expect(screen.getByText('This link has expired')).toBeTruthy()
    expect(verifyEmail).not.toHaveBeenCalled()
  })

  it('R-01 keeps the token usable and says so when verifyEmail fails for another reason', async () => {
    vi.mocked(verifyEmail).mockRejectedValue(new ApiError(500, 'Server error', 'unknown'))
    start()
    expect((await screen.findByRole('alert')).textContent).toContain('Server error')
  })
})
