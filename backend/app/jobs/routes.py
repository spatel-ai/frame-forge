"""Job and config routes, mounted under /api/v1."""

from typing import Any

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import FileResponse

from ..core.config import Settings
from ..core.errors import ApiError, ErrorOut
from .schemas import ConfigOut, JobOut
from .service import JobService

router = APIRouter(prefix="/api/v1")

_INVALID: dict[int | str, dict[str, Any]] = {422: {"model": ErrorOut}}
_NOT_FOUND: dict[int | str, dict[str, Any]] = {404: {"model": ErrorOut}, **_INVALID}


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
        estimated_video_cost_usd=(
            None if duration is None else round(duration * settings.video_price_per_second_usd, 2)
        ),
        audio_url=f"/api/v1/jobs/{job['id']}/audio" if job["audio_file"] else None,
        video_url=f"/api/v1/jobs/{job['id']}/video" if job["video_file"] else None,
        error=job["error"],
        created_at=job["created_at"],
        updated_at=job["updated_at"],
    )


def _load(request: Request, job_id: str) -> dict:
    job = _service(request).store.get(job_id)
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
        video_price_per_second_usd=settings.video_price_per_second_usd,
    )


@router.post("/jobs", status_code=201, response_model=JobOut, responses=_INVALID)
async def create_job(
    request: Request,
    image: UploadFile = File(...),
    script: str = Form(...),
    language: str = Form(...),
) -> JobOut:
    settings = _settings(request)
    limit = settings.max_image_mb * 1024 * 1024
    raw = await image.read(limit + 1)  # never buffer more than the limit
    job = _service(request).create_job(raw, script, language)
    return _public(job, settings)


@router.get("/jobs/{job_id}", response_model=JobOut, responses=_NOT_FOUND)
def get_job(request: Request, job_id: str) -> JobOut:
    return _public(_load(request, job_id), _settings(request))


@router.post(
    "/jobs/{job_id}/approve",
    response_model=JobOut,
    responses={**_NOT_FOUND, 409: {"model": ErrorOut}},
)
async def approve(request: Request, job_id: str) -> JobOut:
    _load(request, job_id)
    job = _service(request).approve_audio(job_id)
    return _public(job, _settings(request))


def _file(request: Request, job_id: str, column: str) -> FileResponse:
    job = _load(request, job_id)
    if not job[column]:
        raise ApiError(404, "Not available yet.", "not_available_yet")
    return FileResponse(_service(request).job_dir(job_id) / job[column])


@router.get("/jobs/{job_id}/audio", response_class=FileResponse, responses=_NOT_FOUND)
def get_audio(request: Request, job_id: str) -> FileResponse:
    return _file(request, job_id, "audio_file")


@router.get("/jobs/{job_id}/video", response_class=FileResponse, responses=_NOT_FOUND)
def get_video(request: Request, job_id: str) -> FileResponse:
    return _file(request, job_id, "video_file")
