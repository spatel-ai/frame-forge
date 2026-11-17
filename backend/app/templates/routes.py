"""Banner template routes (T-506; R-44, R-46, R-47).

Any logged-in customer may list the active templates and play their previews; templates are the
company's, not the customer's. A retired or unknown template is 404 `template_not_found`. Admins
add and retire templates in M6 (T-600 contract); until then the command line does it."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from sqlalchemy import Engine
from starlette.concurrency import run_in_threadpool

from ..auth.deps import CurrentUser, current_user
from ..core.config import Settings
from ..core.errors import ApiError, ErrorOut
from . import service
from .schemas import TemplateOut, TemplatesOut

router = APIRouter(prefix="/api/v1/templates", tags=["templates"])

User = Annotated[CurrentUser, Depends(current_user)]
_E: dict[str, Any] = {"model": ErrorOut}


def _engine(request: Request) -> Engine:
    return request.app.state.service.store.engine


@router.get(
    "",
    response_model=TemplatesOut,
    responses={401: _E},
    summary="Active banner templates for the Create banners step (D-058)",
)
async def list_templates(request: Request, user: User) -> TemplatesOut:
    rows = await run_in_threadpool(service.list_templates, _engine(request))
    return TemplatesOut(
        items=[
            TemplateOut(
                id=t.id,
                name=t.name,
                kind=t.kind,  # type: ignore[arg-type]
                duration_ms=t.duration_ms,
                has_audio=t.has_audio,
                preview_url=f"/api/v1/templates/{t.id}/preview",
            )
            for t in rows
        ]
    )


@router.get(
    "/{template_id}/preview",
    response_class=FileResponse,
    responses={401: _E, 404: _E, 422: _E},
    summary="A template's preview clip (video/mp4)",
)
async def get_preview(request: Request, template_id: str, user: User) -> FileResponse:
    row = await run_in_threadpool(service.get_active, _engine(request), template_id)
    settings: Settings = request.app.state.settings
    path = service.templates_dir(settings) / row.preview_file if row else None
    if path is None or not path.is_file():
        raise ApiError(404, "We could not find that template.", "template_not_found")
    return FileResponse(path, media_type="video/mp4")
