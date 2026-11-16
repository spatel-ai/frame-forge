"""Exception handlers for the jobs package's own errors, registered from `main.py`."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ..core.errors import error_response
from .service import Conflict, JobNotFound, ValidationError


async def _invalid_input(_: Request, exc: ValidationError) -> JSONResponse:
    return error_response(422, str(exc), "invalid_input", fields={exc.field: str(exc)})


async def _wrong_state(_: Request, exc: Conflict) -> JSONResponse:
    return error_response(409, str(exc), "wrong_state")


async def _not_found(_: Request, exc: JobNotFound) -> JSONResponse:
    return error_response(404, "Job not found.", "job_not_found")


def register_job_error_handlers(app: FastAPI) -> None:
    # Starlette types a handler as (Request, Exception); see core/errors.py.
    app.add_exception_handler(ValidationError, _invalid_input)  # type: ignore[arg-type]
    app.add_exception_handler(Conflict, _wrong_state)  # type: ignore[arg-type]
    app.add_exception_handler(JobNotFound, _not_found)  # type: ignore[arg-type]
