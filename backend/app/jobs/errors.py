"""Exception handlers for the jobs package's own errors, registered from `main.py`."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ..core.errors import error_response
from .service import Conflict, ValidationError


async def _invalid_input(_: Request, exc: ValidationError) -> JSONResponse:
    return error_response(422, str(exc), "invalid_input")


async def _wrong_state(_: Request, exc: Conflict) -> JSONResponse:
    return error_response(409, str(exc), "wrong_state")


def register_job_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ValidationError, _invalid_input)
    app.add_exception_handler(Conflict, _wrong_state)
