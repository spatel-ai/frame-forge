"""Job and config routes, mounted under /api/v1."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import FileResponse

from ..auth.deps import CurrentUser, current_user
from ..core.config import Settings
from ..core.errors import ApiError, ErrorOut
from .schemas import ConfigOut, JobOut
from .service import JobService

router = APIRouter(prefix="/api/v1")

_INVALID: dict[int | str, dict[str, Any]] = {422: {"model": ErrorOut}}
_UNAUTHENTICATED: dict[int | str, dict[str, Any]] = {401: {"model": ErrorOut}}
_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    **_UNAUTHENTICATED,
    404: {"model": ErrorOut},
    **_INVALID,
}
_UNCONFIRMED: dict[int | str, dict[str, Any]] = {403: {"model": ErrorOut}}
# 402 insufficient_credits: fewer credits available than the voice price (create) or the video
# price (approve). D-006, D-038; the detail states the amounts.
_CREDITS: dict[int | str, dict[str, Any]] = {402: {"model": ErrorOut}}

User = Annotated[CurrentUser, Depends(current_user)]


def _confirmed_user(user: User) -> CurrentUser:
    _require_confirmed_email(user)
    return user


ConfirmedUser = Annotated[CurrentUser, Depends(_confirmed_user)]


def _service(request: Request) -> JobService:
    return request.app.state.service


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _public(job: dict, settings: Settings) -> JobOut:
    duration = job["audio_duration_seconds"]
    return JobOut(
        id=job["id"],
        status=job["status"],
        language=job["language"],
        script=job["script"],
        audio_duration_seconds=duration,
        # Filled by T-303 (pricing) and T-304 (ledger); the contract is fixed here (T-300).
        price_credits=None,
        charged_credits=0,
        audio_url=f"/api/v1/jobs/{job['id']}/audio" if job["audio_file"] else None,
        video_url=f"/api/v1/jobs/{job['id']}/video" if job["video_file"] else None,
        error=job["error"],
        created_at=job["created_at"],
        updated_at=job["updated_at"],
    )


def _require_confirmed_email(user: CurrentUser) -> None:
    if not user.email_verified:
        raise ApiError(
            403,
            "Confirm your email to make videos. We sent you a link; you can ask for a new one.",
            "email_not_verified",
        )


def _load(request: Request, user: CurrentUser, job_id: str) -> dict:
    # Missing, someone else's and ownerless jobs all look the same: 404 (R-12).
    job = _service(request).store.get_owned(job_id, user.id)
    if job is None:
        raise ApiError(404, "Job not found.", "job_not_found")
    return job


@router.get("/config", response_model=ConfigOut)
def get_config(request: Request) -> ConfigOut:
    settings = _settings(request)
    return ConfigOut(
        # Provider.name is a plain str; ConfigOut narrows it to "mock" | "fal" (providers.py
        # is a money-critical file and is not changed here).
        provider=_service(request).provider.name,  # type: ignore[arg-type]
        max_audio_seconds=settings.max_audio_seconds,
        max_script_chars=settings.max_script_chars,
        max_image_mb=settings.max_image_mb,
        languages=list(settings.languages),
        credits_per_second=settings.credits_per_second,
        voice_price_credits=settings.voice_price_credits,
    )


@router.post(
    "/jobs",
    status_code=201,
    response_model=JobOut,
    responses={**_UNAUTHENTICATED, **_CREDITS, **_UNCONFIRMED, **_INVALID},
)
async def create_job(
    request: Request,
    user: ConfirmedUser,  # 401 then 403, ahead of input validation and the upload read
    image: UploadFile = File(...),
    script: str = Form(...),
    language: str = Form(...),
) -> JobOut:
    settings = _settings(request)
    limit = settings.max_image_mb * 1024 * 1024
    raw = await image.read(limit + 1)  # never buffer more than the limit
    job = _service(request).create_job(user.id, raw, script, language)
    return _public(job, settings)


@router.get("/jobs/{job_id}", response_model=JobOut, responses=_NOT_FOUND)
def get_job(request: Request, user: User, job_id: str) -> JobOut:
    return _public(_load(request, user, job_id), _settings(request))


@router.post(
    "/jobs/{job_id}/approve",
    response_model=JobOut,
    responses={**_NOT_FOUND, **_CREDITS, **_UNCONFIRMED, 409: {"model": ErrorOut}},
)
async def approve(request: Request, user: User, job_id: str) -> JobOut:
    _load(request, user, job_id)  # 404 first, so another user's job id is never confirmed
    _require_confirmed_email(user)
    job = _service(request).approve_audio(user.id, job_id)
    return _public(job, _settings(request))


def _file(request: Request, user: CurrentUser, job_id: str, column: str) -> FileResponse:
    job = _load(request, user, job_id)
    if not job[column]:
        raise ApiError(404, "Not available yet.", "not_available_yet")
    return FileResponse(_service(request).job_dir(job_id) / job[column])


@router.get("/jobs/{job_id}/audio", response_class=FileResponse, responses=_NOT_FOUND)
def get_audio(request: Request, user: User, job_id: str) -> FileResponse:
    return _file(request, user, job_id, "audio_file")


@router.get("/jobs/{job_id}/video", response_class=FileResponse, responses=_NOT_FOUND)
def get_video(request: Request, user: User, job_id: str) -> FileResponse:
    return _file(request, user, job_id, "video_file")
