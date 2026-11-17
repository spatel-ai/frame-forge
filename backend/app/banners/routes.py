"""Banner routes: the contract for D-067. Every handler answers 501 `not_implemented` until built.

A banner is an image (logo or designed card) the customer uploads once and picks for each video.
Only the caller's own banners are listed, shown or deleted: another user's banner is 404
`banner_not_found`. Deleting a banner never changes a video already made (the job keeps a copy)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.responses import FileResponse

from ..auth.deps import CurrentUser, current_user
from ..core.errors import ApiError, ErrorOut
from .schemas import BannerOut, BannersOut

router = APIRouter(prefix="/api/v1/banners", tags=["banners"])

User = Annotated[CurrentUser, Depends(current_user)]
_E: dict[str, Any] = {"model": ErrorOut}


def _not_built() -> ApiError:
    return ApiError(501, "This is not built yet.", "not_implemented")


@router.get(
    "",
    response_model=BannersOut,
    responses={401: _E, 501: _E},
    summary="The caller's banners, newest first",
)
def list_banners(user: User) -> BannersOut:
    raise _not_built()


@router.post(
    "",
    status_code=201,
    response_model=BannerOut,
    responses={401: _E, 422: _E, 501: _E},
    summary="Upload a banner image (PNG, JPEG or WebP) with a name",
)
def create_banner(
    user: User,
    name: Annotated[str, Form()],
    image: Annotated[UploadFile, File()],
) -> BannerOut:
    raise _not_built()


@router.get(
    "/{banner_id}/image",
    response_class=FileResponse,
    responses={401: _E, 404: _E, 422: _E, 501: _E},
    summary="A banner's image, for its owner",
)
def get_banner_image(banner_id: str, user: User) -> FileResponse:
    raise _not_built()


@router.delete(
    "/{banner_id}",
    status_code=204,
    response_class=Response,
    responses={401: _E, 404: _E, 422: _E, 501: _E},
    summary="Delete one of the caller's banners; videos already made are unchanged",
)
def delete_banner(banner_id: str, user: User) -> Response:
    raise _not_built()
