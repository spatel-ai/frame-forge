"""Banner template routes: the M5 contract (task T-500). Every handler answers 501
`not_implemented` until T-506 builds them.

Any logged-in customer may list the active templates and play their previews; templates are the
company's, not the customer's. A retired or unknown template is 404 `template_not_found`. Admins
add and retire templates in M6 (T-600 contract)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from ..auth.deps import CurrentUser, current_user
from ..core.errors import ApiError, ErrorOut
from .schemas import TemplatesOut

router = APIRouter(prefix="/api/v1/templates", tags=["templates"])

User = Annotated[CurrentUser, Depends(current_user)]
_E: dict[str, Any] = {"model": ErrorOut}


def _not_built() -> ApiError:
    return ApiError(501, "This is not built yet.", "not_implemented")


@router.get(
    "",
    response_model=TemplatesOut,
    responses={401: _E, 501: _E},
    summary="Active banner templates for the Create banners step (D-058)",
)
def list_templates(user: User) -> TemplatesOut:
    raise _not_built()


@router.get(
    "/{template_id}/preview",
    response_class=FileResponse,
    responses={401: _E, 404: _E, 422: _E, 501: _E},
    summary="A template's preview clip (video/mp4)",
)
def get_preview(template_id: str, user: User) -> FileResponse:
    raise _not_built()
