"""Cross-site request refusal (D-035, task T-205).

State-changing requests (POST, PUT, PATCH, DELETE) are refused with 403 `origin_refused` when
the `Origin` header is present and not allowed, or when it is absent and the browser says
`Sec-Fetch-Site: cross-site`. Requests with neither header (curl, the test client) pass, and
other methods are never checked. Together with SameSite=Lax cookies this stops cross-site
form posts without tokens in every form."""

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from .errors import error_response

CHECKED_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
REFUSED_MESSAGE = "This request came from another website and was refused."


def _normal(origin: str) -> str:
    return origin.strip().rstrip("/").lower()


class OriginMiddleware:
    def __init__(self, app: ASGIApp, allowed_origins: tuple[str, ...]):
        self.app = app
        self.allowed = frozenset(_normal(o) for o in allowed_origins)

    def _refuse(self, headers: Headers) -> bool:
        origin = headers.get("origin")
        if origin is not None:
            return _normal(origin) not in self.allowed
        return headers.get("sec-fetch-site", "").strip().lower() == "cross-site"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in CHECKED_METHODS:
            if self._refuse(Headers(scope=scope)):
                response = error_response(403, REFUSED_MESSAGE, "origin_refused")
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
