"""Script library routes (contract T-500, built in T-504; R-43, R-50, R-12).

A script is saved automatically when a job uses it (D-017); there is no create route. Only the
caller's own scripts are ever listed, read or deleted: another user's script is 404
`script_not_found`. Deleting a script never changes a job, which keeps its own copy."""

from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import Engine
from starlette.concurrency import run_in_threadpool

from ..auth.deps import CurrentUser, current_user
from ..core.errors import ApiError, ErrorOut
from . import service
from .schemas import ScriptOut, ScriptsOut

router = APIRouter(prefix="/api/v1/scripts", tags=["scripts"])

User = Annotated[CurrentUser, Depends(current_user)]
_E: dict[str, Any] = {"model": ErrorOut}


def _engine(request: Request) -> Engine:
    return request.app.state.service.store.engine


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def _out(row: service.ScriptRow) -> ScriptOut:
    return ScriptOut(
        id=row.id,
        language=row.language,
        text=row.text,
        created_at=_iso(row.created_at),
        last_used_at=_iso(row.last_used_at),
    )


def _not_found() -> ApiError:
    return ApiError(404, "We could not find that script.", "script_not_found")


@router.get(
    "",
    response_model=ScriptsOut,
    responses={401: _E, 422: _E},
    summary="The caller's saved scripts, most recently used first; optional search and language",
)
async def list_scripts(
    request: Request,
    user: User,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    q: Annotated[str | None, Query(max_length=200)] = None,
    language: Annotated[str | None, Query(max_length=16)] = None,
) -> ScriptsOut:
    rows, total = await run_in_threadpool(
        service.list_scripts, _engine(request), user.id, page, page_size, q, language
    )
    return ScriptsOut(items=[_out(r) for r in rows], total=total, page=page, page_size=page_size)


@router.get(
    "/{script_id}",
    response_model=ScriptOut,
    responses={401: _E, 404: _E, 422: _E},
    summary="One of the caller's saved scripts",
)
async def get_script(script_id: str, request: Request, user: User) -> ScriptOut:
    row = await run_in_threadpool(service.get_script, _engine(request), user.id, script_id)
    if row is None:
        raise _not_found()
    return _out(row)


@router.delete(
    "/{script_id}",
    status_code=204,
    response_class=Response,
    responses={401: _E, 404: _E, 422: _E},
    summary="Delete one of the caller's saved scripts; videos made with it are unchanged",
)
async def delete_script(script_id: str, request: Request, user: User) -> Response:
    if not await run_in_threadpool(service.delete_script, _engine(request), user.id, script_id):
        raise _not_found()
    return Response(status_code=204)
