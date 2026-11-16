import type { RouteObject } from 'react-router'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { ForgotPasswordSentPage } from './ForgotPasswordSentPage'
import { LoginPage } from './LoginPage'
import { ResetPasswordPage } from './ResetPasswordPage'
import { SignupPage } from './SignupPage'
import { VerifyEmailPage } from './VerifyEmailPage'

/** Auth screens. Mounted by the route table (T-211), outside the app shell. */
export const authRoutes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/forgot-password/sent', element: <ForgotPasswordSentPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
]
