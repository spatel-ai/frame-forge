"""One error shape for the whole API: {"detail": "<message for the user>", "code": "<machine_code>"}.

`detail` is always a string. Internal errors never expose exception text or a stack trace."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger(__name__)

INTERNAL_MESSAGE = "Something went wrong on our side. Please try again."


class ErrorOut(BaseModel):
    detail: str
    code: str


class ApiError(Exception):
    """Raised by routes for an expected error with a stable machine code."""

    def __init__(self, status_code: int, detail: str, code: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code


def error_response(
    status_code: int, detail: str, code: str, headers: dict[str, str] | None = None
) -> JSONResponse:
    return JSONResponse({"detail": detail, "code": code}, status_code=status_code, headers=headers)


def internal_error_response() -> JSONResponse:
    return error_response(500, INTERNAL_MESSAGE, "internal_error")


def _flatten_validation(exc: RequestValidationError) -> str:
    parts = []
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path", "form")]
        msg = str(err.get("msg", "Invalid value"))
        parts.append(f"{'.'.join(loc)}: {msg}" if loc else msg)
    if not parts:
        return "The request is not valid."
    return "The request is not valid. " + "; ".join(parts) + "."


async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
    return error_response(exc.status_code, exc.detail, exc.code)


async def _request_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
    return error_response(422, _flatten_validation(exc), "validation_error")


async def _http_exception(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    # Unknown routes and wrong methods are raised by Starlette's router as plain HTTPExceptions.
    codes = {404: ("not_found", "Not found."), 405: ("method_not_allowed", "Method not allowed.")}
    if exc.status_code in codes:
        code, detail = codes[exc.status_code]
    else:
        code, detail = "http_error", "The request could not be completed."
    return error_response(exc.status_code, detail, code, headers=getattr(exc, "headers", None))


async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
    log.error("Unhandled error", exc_info=exc)
    return internal_error_response()


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error)
    app.add_exception_handler(RequestValidationError, _request_validation)
    app.add_exception_handler(StarletteHTTPException, _http_exception)
    app.add_exception_handler(Exception, _unhandled)
