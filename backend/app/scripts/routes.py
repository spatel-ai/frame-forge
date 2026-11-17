"""Script library routes: the M5 contract (task T-500). Every handler answers 501
`not_implemented` until T-504 builds it.

A script is saved automatically when a job uses it (D-017); there is no create route. Only the
caller's own scripts are ever listed, read or deleted: another user's script is 404
`script_not_found`. Deleting a script never changes a job, which keeps its own copy."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from ..auth.deps import CurrentUser, current_user
from ..core.errors import ApiError, ErrorOut
from .schemas import ScriptOut, ScriptsOut

router = APIRouter(prefix="/api/v1/scripts", tags=["scripts"])

User = Annotated[CurrentUser, Depends(current_user)]
_E: dict[str, Any] = {"model": ErrorOut}


def _not_built() -> ApiError:
    return ApiError(501, "This is not built yet.", "not_implemented")


@router.get(
    "",
    response_model=ScriptsOut,
    responses={401: _E, 422: _E, 501: _E},
    summary="The caller's saved scripts, most recently used first; optional search and language",
)
def list_scripts(
    user: User,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    q: Annotated[str | None, Query(max_length=200)] = None,
    language: Annotated[str | None, Query(max_length=16)] = None,
) -> ScriptsOut:
    raise _not_built()


@router.get(
    "/{script_id}",
    response_model=ScriptOut,
    responses={401: _E, 404: _E, 422: _E, 501: _E},
    summary="One of the caller's saved scripts",
)
def get_script(script_id: str, user: User) -> ScriptOut:
    raise _not_built()


@router.delete(
    "/{script_id}",
    status_code=204,
    response_class=Response,
    responses={401: _E, 404: _E, 422: _E, 501: _E},
    summary="Delete one of the caller's saved scripts; videos made with it are unchanged",
)
def delete_script(script_id: str, user: User) -> Response:
    raise _not_built()
