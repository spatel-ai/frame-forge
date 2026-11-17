"""Banner routes (contract D-067, built here; R-12).

A banner is an image (logo or designed card) the customer uploads once and picks for each video.
Only the caller's own banners are listed, shown or deleted: another user's banner is 404
`banner_not_found`. Deleting a banner never changes a video already made (the job keeps a copy)."""

from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import Engine
from starlette.concurrency import run_in_threadpool

from ..auth.deps import CurrentUser, current_user
from ..core.config import Settings
from ..core.errors import ApiError, ErrorOut
from . import service
from .schemas import BannerOut, BannersOut

router = APIRouter(prefix="/api/v1/banners", tags=["banners"])

User = Annotated[CurrentUser, Depends(current_user)]
_E: dict[str, Any] = {"model": ErrorOut}


def _engine(request: Request) -> Engine:
    return request.app.state.service.store.engine


def _data_dir(request: Request) -> Path:
    settings: Settings = request.app.state.settings
    return settings.data_dir


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def _out(row: service.BannerRow) -> BannerOut:
    return BannerOut(
        id=row.id,
        name=row.name,
        image_url=f"/api/v1/banners/{row.id}/image",
        created_at=_iso(row.created_at),
    )


def _not_found() -> ApiError:
    return ApiError(404, "We could not find that banner.", "banner_not_found")


@router.get(
    "",
    response_model=BannersOut,
    responses={401: _E},
    summary="The caller's banners, newest first",
)
async def list_banners(request: Request, user: User) -> BannersOut:
    rows = await run_in_threadpool(service.list_banners, _engine(request), user.id)
    return BannersOut(items=[_out(r) for r in rows])


@router.post(
    "",
    status_code=201,
    response_model=BannerOut,
    responses={401: _E, 422: _E},
    summary="Upload a banner image (PNG, JPEG or WebP) with a name",
)
async def create_banner(
    request: Request,
    user: User,
    name: Annotated[str, Form()],
    image: Annotated[UploadFile, File()],
) -> BannerOut:
    # Read one byte past the limit so an oversized file is refused without loading all of it.
    raw = await image.read(service.MAX_IMAGE_BYTES + 1)
    row = await run_in_threadpool(
        service.create, _engine(request), _data_dir(request), user.id, name, raw
    )
    return _out(row)


@router.get(
    "/{banner_id}/image",
    response_class=FileResponse,
    responses={401: _E, 404: _E, 422: _E},
    summary="A banner's image, for its owner",
)
async def get_banner_image(banner_id: str, request: Request, user: User) -> FileResponse:
    path = await run_in_threadpool(
        service.get_owned_file, _engine(request), user.id, banner_id, _data_dir(request)
    )
    if path is None:
        raise _not_found()
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "private"})


@router.delete(
    "/{banner_id}",
    status_code=204,
    response_class=Response,
    responses={401: _E, 404: _E, 422: _E},
    summary="Delete one of the caller's banners; videos already made are unchanged",
)
async def delete_banner(banner_id: str, request: Request, user: User) -> Response:
    if not await run_in_threadpool(service.delete_banner, _engine(request), user.id, banner_id):
        raise _not_found()
    return Response(status_code=204)
