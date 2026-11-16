"""FastAPI dependencies for auth: the service, the session cookie and `current_user`."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request, Response

from ..core.errors import ApiError
from .schemas import SESSION_COOKIE
from .service import AuthService


def get_auth_service(request: Request) -> AuthService:
    return request.app.state.auth_service


@dataclass(frozen=True)
class CurrentUser:
    id: str
    name: str
    email: str
    role: str
    email_verified: bool
    session_id: str  # the session this request came in on


def session_token(request: Request) -> str | None:
    # Read from the request, not declared as a Cookie parameter, so FastAPI does not add a 422
    # response to routes whose documented responses are fixed by the contract.
    return request.cookies.get(SESSION_COOKIE)


def current_user(
    service: Annotated[AuthService, Depends(get_auth_service)],
    token: Annotated[str | None, Depends(session_token)],
) -> CurrentUser:
    """The logged-in user, or 401 `not_authenticated`. Use as `Depends(current_user)`; the
    session id is on the result."""
    found = service.authenticate(token)
    if found is None:
        raise ApiError(401, "Please log in to continue.", "not_authenticated")
    return CurrentUser(
        id=found["id"],
        name=found["name"],
        email=found["email"],
        role=found["role"],
        email_verified=found["email_verified_at"] is not None,
        session_id=found["session_id"],
    )


def set_session_cookie(response: Response, token: str, max_age: int) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age,
        path="/",
        httponly=True,
        secure=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, secure=True, samesite="lax")
