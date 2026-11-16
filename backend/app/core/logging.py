"""Request ids: every request gets one, it is returned in `X-Request-ID`, and it appears on
every log line written while the request is handled. Request bodies are never logged."""

import contextvars
import logging
import re
import time
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .errors import internal_error_response

HEADER = "X-Request-ID"
_VALID_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
LOG_FORMAT = "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s"

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
log = logging.getLogger("app.request")


def configure_logging() -> None:
    """Put the current request id on every log record, whichever logger wrote it."""
    previous = logging.getLogRecordFactory()
    if not getattr(previous, "_adds_request_id", False):

        def factory(*args, **kwargs):
            record = previous(*args, **kwargs)
            record.request_id = request_id_var.get()
            return record

        factory._adds_request_id = True  # type: ignore[attr-defined]
        logging.setLogRecordFactory(factory)
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)


def _request_id(scope: Scope) -> str:
    incoming = Headers(scope=scope).get(HEADER)
    if incoming is not None and _VALID_ID.fullmatch(incoming):
        return incoming
    return uuid.uuid4().hex


class RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        rid = _request_id(scope)
        token = request_id_var.set(rid)
        status = 500
        started = time.perf_counter()

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message)[HEADER] = rid
            await send(message)

        try:
            try:
                await self.app(scope, receive, send_with_id)
            except Exception:
                # Answer here, inside the request-id context, so the 500 carries the id too.
                log.exception("Unhandled error")
                await internal_error_response()(scope, receive, send_with_id)
        finally:
            # Method and path only: never the query string, body or headers.
            log.info(
                "%s %s -> %s (%.0f ms)",
                scope["method"],
                scope["path"],
                status,
                (time.perf_counter() - started) * 1000,
            )
            request_id_var.reset(token)
