"""Request and response shapes for the auth routes: the M2 contract (task T-200).

The frontend generates its TypeScript types from these through the OpenAPI document. Input rules
(name 1-80 characters, a valid email, password 10-128 characters) are checked by the service so
that each message can name its field (D-029); the shapes here stay plain strings."""

from typing import Literal

from pydantic import BaseModel

# The session cookie (D-003): an opaque random token, HttpOnly, Secure, SameSite=Lax, Path=/.
SESSION_COOKIE = "ff_session"


class SignupIn(BaseModel):
    name: str
    email: str
    password: str


class LoginIn(BaseModel):
    email: str
    password: str


class TokenIn(BaseModel):
    """A single-use token from an emailed link (confirmation or password reset)."""

    token: str


class ForgotPasswordIn(BaseModel):
    email: str


class ResetPasswordIn(BaseModel):
    token: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    email_verified: bool
    role: Literal["user", "admin"]
    # Sessions of this user that are neither revoked nor expired, this one included.
    active_sessions: int


class ResetCheckOut(BaseModel):
    """Shown on the reset page as "For <email>"."""

    email: str
