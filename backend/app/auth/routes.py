"""Auth routes, mounted under /api/v1/auth: the M2 contract (task T-200).

All handlers are built (T-202: accounts and sessions; T-203: email confirmation and reset).
The routes, bodies, responses and error codes below are the agreed contract; the
builders keep them unchanged or change the contract here first.

Error codes (all with the shape {detail, code, fields?}):
  invalid_credentials 401, not_authenticated 401, email_taken 409, rate_limited 429,
  verify_link_invalid 400, reset_link_invalid 400, origin_refused 403,
  email_not_verified 403 (on job create and approve, D-036),
  validation_error 422 (with `fields`: name, email, password, current_password, new_password)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response

from ..core.errors import ErrorOut
from .deps import (
    CurrentUser,
    clear_session_cookie,
    current_user,
    get_auth_service,
    session_token,
    set_session_cookie,
)
from .schemas import (
    ChangePasswordIn,
    ForgotPasswordIn,
    LoginIn,
    ResetCheckOut,
    ResetPasswordIn,
    SignupIn,
    TokenIn,
    UserOut,
)
from .service import AuthService

Service = Annotated[AuthService, Depends(get_auth_service)]
User = Annotated[CurrentUser, Depends(current_user)]

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

_E = {"model": ErrorOut}
_INVALID: dict[int | str, dict[str, Any]] = {422: _E}
_LIMITED: dict[int | str, dict[str, Any]] = {429: _E}
_AUTH: dict[int | str, dict[str, Any]] = {401: _E}


@router.post(
    "/signup",
    status_code=201,
    response_model=UserOut,
    responses={409: _E, **_INVALID, **_LIMITED},
    summary="Create an account, log in, and send the confirmation email",
)
def signup(body: SignupIn, response: Response, service: Service) -> UserOut:
    user, token = service.signup(body)
    set_session_cookie(response, token, service.session_seconds)
    return user


@router.post(
    "/login",
    response_model=UserOut,
    responses={**_AUTH, **_INVALID, **_LIMITED},
    summary="Log in; sets the session cookie",
)
def login(body: LoginIn, response: Response, service: Service) -> UserOut:
    user, token = service.login(body)
    set_session_cookie(response, token, service.session_seconds)
    return user


@router.post("/logout", status_code=204, summary="End this session and clear the cookie")
def logout(
    response: Response, service: Service, token: Annotated[str | None, Depends(session_token)]
) -> None:
    service.logout(token)
    clear_session_cookie(response)


@router.post(
    "/logout-all", status_code=204, responses=_AUTH, summary="End every session of this user"
)
def logout_all(response: Response, service: Service, user: User) -> None:
    service.logout_all(user.id)
    clear_session_cookie(response)


@router.get("/me", response_model=UserOut, responses=_AUTH, summary="The logged-in user")
def me(service: Service, user: User) -> UserOut:
    return service.me(user.id)


@router.post(
    "/verify-email",
    status_code=204,
    responses={400: _E, **_INVALID},
    summary="Confirm an email address with the token from the emailed link (no login needed)",
)
def verify_email(body: TokenIn, service: Service) -> None:
    service.verify_email(body.token)


@router.post(
    "/verify-email/resend",
    status_code=204,
    responses={**_AUTH, **_LIMITED},
    summary="Send the confirmation email again to the logged-in user",
)
def resend_verification(service: Service, user: User) -> None:
    service.resend_verification(user.id, user.email)


@router.post(
    "/password/forgot",
    status_code=202,
    responses={**_INVALID, **_LIMITED},
    summary="Send a reset link if an account exists; answers the same either way",
)
def forgot_password(body: ForgotPasswordIn, service: Service) -> None:
    service.forgot_password(body.email)


@router.post(
    "/password/reset/check",
    response_model=ResetCheckOut,
    responses={400: _E, **_INVALID},
    summary="Check a reset token before showing the form",
)
def check_reset_token(body: TokenIn, service: Service) -> ResetCheckOut:
    return ResetCheckOut(email=service.check_reset_token(body.token))


@router.post(
    "/password/reset",
    status_code=204,
    responses={400: _E, **_INVALID},
    summary="Set a new password with a reset token; ends every session of that user",
)
def reset_password(body: ResetPasswordIn, response: Response, service: Service) -> None:
    service.reset_password(body.token, body.password)
    # The customer is not logged in by this route; drop any stale cookie.
    clear_session_cookie(response)


@router.post(
    "/password/change",
    status_code=204,
    responses={**_AUTH, **_INVALID},
    summary="Change the password; ends the user's other sessions",
)
def change_password(body: ChangePasswordIn, service: Service, user: User) -> None:
    service.change_password(user.id, user.session_id, body)
