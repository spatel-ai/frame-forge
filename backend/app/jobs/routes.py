"""Job and config routes, mounted under /api/v1."""

import logging
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, RedirectResponse

from ..auth.deps import CurrentUser, current_user
from ..core.config import Settings
from ..core.errors import ApiError, ErrorOut
from ..scripts import service as script_library
from ..wallet import ledger
from . import db
from .schemas import ConfigOut, FailureKind, JobOut, JobsOut, JobSummaryOut, SavedVoicesOut
from .service import JobService

router = APIRouter(prefix="/api/v1")
log = logging.getLogger("avatar")

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


def _paying_user(request: Request, user: ConfirmedUser) -> CurrentUser:
    # 402 after 401 and 403, ahead of input validation (the voice charge itself happens in the
    # job's creation transaction; this read-only check only orders the errors).
    _service(request).check_can_afford_voice(user.id)
    return user


PayingUser = Annotated[CurrentUser, Depends(_paying_user)]


# The Videos page filter (T-501): None means every status.
_STATUS_FILTERS: dict[str, tuple[str, ...] | None] = {
    "all": None,
    "ready": (db.COMPLETED,),
    "in_progress": db.IN_PROGRESS,
    "failed": (db.FAILED,),
}


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _failure_kind(job: dict) -> FailureKind | None:
    """Which failure screen applies, from what the job stored (HLD §5.2). A voice that never
    reached the customer has no audio file; a too-long voice has one but was never approved."""
    if job["status"] != "failed":
        return None
    if not job["audio_file"]:
        return "voice_unknown" if job["needs_review"] else "voice_failed"
    if not job["approve_attempt"]:
        return "voice_too_long"
    return "video_unknown" if job["needs_review"] else "video_failed"


def _voice_reusable(settings: Settings, job: dict) -> bool:
    # D-043: a failed job's voice, if it exists and fits the current length limit (D-056).
    seconds = job["audio_duration_seconds"]
    return (
        job["status"] == "failed"
        and bool(job["audio_file"])
        and seconds is not None
        and seconds <= settings.max_audio_seconds
    )


def _video_expired(job: dict) -> bool:
    """D-065 (R-24): the job's video is stored in S3 or is the provider's link, and its 30 days
    have passed. A local file (mock mode) never expires."""
    if job["video_file"] or not (job["video_key"] or job["video_url"]):
        return False
    if not job["video_expires_at"]:
        return False
    return datetime.fromisoformat(job["video_expires_at"]) <= datetime.now(timezone.utc)


def _public(request: Request, job: dict) -> JobOut:
    voice_credits, video_credits = ledger.job_charge_parts(
        _service(request).store.engine, job["id"]
    )
    return JobOut(
        id=job["id"],
        status=job["status"],
        language=job["language"],
        script=job["script"],
        audio_duration_seconds=job["audio_duration_seconds"],
        # T-303: fixed when the voice was ready (D-006). T-304: what the ledger actually took.
        price_credits=job["price_credits"],
        charged_credits=voice_credits + video_credits,
        voice_credits=voice_credits,
        video_credits=video_credits,
        audio_url=f"/api/v1/jobs/{job['id']}/audio" if job["audio_file"] else None,
        video_url=(
            f"/api/v1/jobs/{job['id']}/video"
            if job["video_file"] or job["video_key"] or job["video_url"]
            else None
        ),
        video_expired=_video_expired(job),
        error=job["error"],
        failure_kind=_failure_kind(job),
        voice_reusable=_voice_reusable(_settings(request), job),
        needs_review=bool(job["needs_review"]),
        # The M5 columns arrive with T-509 and T-516; until then none is recorded.
        consent_at=job["consent_at"],
        script_id=job["script_id"],
        voice_from_job_id=None,
        start_template=None,
        end_template=None,
        banners_applied=job["banners_applied"],  # D-019, D-066
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
        payments=settings.payments,  # type: ignore[arg-type]  # Settings checks the value
        razorpay_key_id=settings.razorpay_key_id if settings.payments == "razorpay" else None,
        min_purchase_credits=settings.min_purchase_credits,
        max_purchase_credits=settings.max_purchase_credits,
        payment_fee_bps=settings.payment_fee_bps,
        payment_fee_gst_bps=settings.payment_fee_gst_bps,
        support_email=settings.support_email or None,
        consent_version=settings.consent_version,
        consent_text=settings.consent_text,
        daily_video_limit=settings.effective_daily_video_limit,
        banners_enabled=settings.banners_enabled,
    )


@router.post(
    "/jobs",
    status_code=201,
    response_model=JobOut,
    responses={
        **_UNAUTHENTICATED,
        **_CREDITS,
        **_UNCONFIRMED,
        404: {"model": ErrorOut},  # M5: script_not_found, voice_not_found
        **_INVALID,
        429: {"model": ErrorOut},  # M5: daily_limit_reached is checked at approval, not here
        501: {"model": ErrorOut},
    },
)
async def create_job(
    request: Request,
    user: PayingUser,  # 401, 403, then 402, ahead of input validation and the upload read
    image: UploadFile = File(...),
    # Exactly one of `script` (pasted text) or `script_id` (a saved script, T-505) is used.
    script: Annotated[str | None, Form()] = None,
    language: Annotated[str | None, Form()] = None,
    # M5 contract (T-500). Consent is required (T-502, R-14, D-045). The others answer 501 until
    # built: banners (T-509), a saved voice (T-516). See docs/M5-PLAN.md.
    consent: Annotated[bool | None, Form()] = None,
    consent_version: Annotated[str | None, Form()] = None,
    script_id: Annotated[str | None, Form()] = None,
    start_template_id: Annotated[str | None, Form()] = None,
    end_template_id: Annotated[str | None, Form()] = None,
    voice_from_job_id: Annotated[str | None, Form()] = None,
) -> JobOut:
    if any(v is not None for v in (start_template_id, end_template_id, voice_from_job_id)):
        raise ApiError(501, "This is not built yet.", "not_implemented")
    settings = _settings(request)
    # R-14, D-045: no consent, no job. Checked after 401/403/402 and before the image is read, so
    # nothing is charged or stored when it fails.
    if consent is not True:
        raise ApiError(
            422,
            "Confirm you have permission to use this photo.",
            "consent_required",
            {"consent": "Tick the box to confirm you have permission to use this photo."},
        )
    if consent_version != settings.consent_version:
        raise ApiError(
            422,
            "The consent wording has changed. Reload the page and try again.",
            "consent_outdated",
            {"consent": "The consent wording has changed. Reload the page to see it."},
        )
    # R-43, R-51: a saved script supplies its own text and language (a sent `language` is ignored,
    # so the job always matches what was saved). Missing, deleted and another user's all answer
    # the same 404 (R-12). With neither field there is nothing to say: 422 on `script`.
    if script_id is not None:
        saved = script_library.get_script(_service(request).store.engine, user.id, script_id)
        if saved is None:
            raise ApiError(404, "Script not found.", "script_not_found")
        script, language = saved.text, saved.language
    elif script is None:
        message = "Write a script, or choose one from My scripts."
        raise ApiError(422, message, "validation_error", {"script": message})
    if language is None:
        message = "Choose the language of the script."
        raise ApiError(422, message, "validation_error", {"language": message})
    limit = settings.max_image_mb * 1024 * 1024
    raw = await image.read(limit + 1)  # never buffer more than the limit
    job = _service(request).create_job(user.id, raw, script, language or "", consent_version)
    return _public(request, job)


@router.get(
    "/jobs",
    response_model=JobsOut,
    responses={**_UNAUTHENTICATED, **_INVALID},
    summary="The caller's jobs, newest first (T-501)",
)
def list_jobs(
    request: Request,
    user: User,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    status: Literal["all", "ready", "in_progress", "failed"] = "all",
    q: Annotated[str | None, Query(max_length=200)] = None,
) -> JobsOut:
    statuses = _STATUS_FILTERS[status]
    jobs, total = _service(request).store.list_owned(user.id, page, page_size, statuses, q)
    return JobsOut(
        items=[
            JobSummaryOut(
                id=j["id"],
                status=j["status"],
                language=j["language"],
                script_excerpt=j["script"][:120],
                audio_duration_seconds=j["audio_duration_seconds"],
                failure_kind=_failure_kind(j),
                video_expired=_video_expired(j),
                created_at=j["created_at"],
                updated_at=j["updated_at"],
            )
            for j in jobs
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/voices",
    response_model=SavedVoicesOut,
    responses={**_UNAUTHENTICATED, 501: {"model": ErrorOut}},
    summary="Voices from the caller's failed jobs that can start a new job (T-516, D-043)",
)
def list_saved_voices(request: Request, user: User) -> SavedVoicesOut:
    raise ApiError(501, "This is not built yet.", "not_implemented")


@router.get("/jobs/{job_id}", response_model=JobOut, responses=_NOT_FOUND)
def get_job(request: Request, user: User, job_id: str) -> JobOut:
    return _public(request, _load(request, user, job_id))


@router.post(
    "/jobs/{job_id}/approve",
    response_model=JobOut,
    responses={
        **_NOT_FOUND,
        **_CREDITS,
        **_UNCONFIRMED,
        409: {"model": ErrorOut},
        429: {"model": ErrorOut},  # daily_limit_reached outside production (D-046, T-503)
    },
)
async def approve(request: Request, user: User, job_id: str) -> JobOut:
    _load(request, user, job_id)  # 404 first, so another user's job id is never confirmed
    _require_confirmed_email(user)
    job = _service(request).approve_audio(user.id, job_id)
    return _public(request, job)


def _file(request: Request, user: CurrentUser, job_id: str, column: str) -> FileResponse:
    job = _load(request, user, job_id)
    if not job[column]:
        raise ApiError(404, "Not available yet.", "not_available_yet")
    return FileResponse(_service(request).job_dir(job_id) / job[column])


@router.get("/jobs/{job_id}/audio", response_class=FileResponse, responses=_NOT_FOUND)
def get_audio(request: Request, user: User, job_id: str) -> FileResponse:
    return _file(request, user, job_id, "audio_file")


@router.get(
    "/jobs/{job_id}/video",
    response_class=FileResponse,
    responses={
        **_NOT_FOUND,
        302: {"description": "Redirect to the provider's link to the video (D-065)."},
        410: {"model": ErrorOut},  # video_expired: the provider deleted it after 30 days
    },
)
def get_video(request: Request, user: User, job_id: str) -> Response:
    """The job's video: a 302 to a short-lived signed S3 link (owner, 2026-11-17), the
    provider's link for older jobs (D-065, R-24, R-74), or our file (mock mode), while it lives.
    Ownership is checked first, so another user's job is 404 (R-12). The signed link is only
    ever sent as this redirect, never in JSON."""
    job = _load(request, user, job_id)
    if job["video_key"] and not job["video_file"]:
        if _video_expired(job):
            message = "This video has expired. Videos are kept for 30 days."
            raise ApiError(410, message, "video_expired")
        storage = _service(request).storage
        if storage is None:
            # Stored in S3 but this server has no bucket configured: a deployment mistake.
            log.error("job %s has a stored video but no video storage is configured", job_id)
            raise ApiError(404, "Not available yet.", "not_available_yet")
        link = storage.url(job["video_key"], filename=f"frameforge-video-{job_id}.mp4")
        return RedirectResponse(link, status_code=302)
    if job["video_url"] and not job["video_file"]:
        if _video_expired(job):
            message = "This video has expired. Videos are kept for 30 days."
            raise ApiError(410, message, "video_expired")
        return RedirectResponse(job["video_url"], status_code=302)
    if not job["video_file"]:
        raise ApiError(404, "Not available yet.", "not_available_yet")
    return FileResponse(_service(request).job_dir(job_id) / job["video_file"])
