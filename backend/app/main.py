"""HTTP API for the Talking Avatar POC."""

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .config import Settings
from .db import JobStore
from .providers import Provider, build_provider
from .service import Conflict, JobService, ValidationError

logging.basicConfig(level=logging.INFO)


def _public(job: dict, settings: Settings) -> dict:
    duration = job["audio_duration_seconds"]
    return {
        "id": job["id"],
        "status": job["status"],
        "language": job["language"],
        "script": job["script"],
        "audio_duration_seconds": duration,
        "estimated_video_cost_usd": (
            None if duration is None else round(duration * settings.video_price_per_second_usd, 2)
        ),
        "audio_url": f"/api/jobs/{job['id']}/audio" if job["audio_file"] else None,
        "video_url": f"/api/jobs/{job['id']}/video" if job["video_file"] else None,
        "error": job["error"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
    }


def create_app(
    settings: Settings | None = None,
    provider: Provider | None = None,
    start_poller: bool = True,
) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store = JobStore(settings.db_path)
        service = JobService(settings, store, provider or build_provider(settings))
        service.recover_interrupted()
        app.state.service = service
        poller = asyncio.create_task(service.run_poller()) if start_poller else None
        try:
            yield
        finally:
            if poller:
                poller.cancel()
                with suppress(asyncio.CancelledError):
                    await poller
            store.close()

    app = FastAPI(title="Talking Avatar POC", lifespan=lifespan)

    def service() -> JobService:
        return app.state.service

    def load(job_id: str) -> dict:
        job = service().store.get(job_id)
        if job is None:
            raise HTTPException(404, "Job not found.")
        return job

    @app.get("/api/config")
    def get_config() -> dict:
        return {
            "provider": service().provider.name,
            "max_audio_seconds": settings.max_audio_seconds,
            "max_script_chars": settings.max_script_chars,
            "max_image_mb": settings.max_image_mb,
            "languages": list(settings.languages),
            "video_price_per_second_usd": settings.video_price_per_second_usd,
        }

    @app.post("/api/jobs", status_code=201)
    async def create_job(
        image: UploadFile = File(...), script: str = Form(...), language: str = Form(...)
    ) -> dict:
        limit = settings.max_image_mb * 1024 * 1024
        raw = await image.read(limit + 1)  # never buffer more than the limit
        try:
            job = service().create_job(raw, script, language)
        except ValidationError as exc:
            raise HTTPException(422, str(exc)) from None
        return _public(job, settings)

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str) -> dict:
        return _public(load(job_id), settings)

    @app.post("/api/jobs/{job_id}/approve")
    async def approve(job_id: str) -> dict:
        load(job_id)
        try:
            job = service().approve_audio(job_id)
        except Conflict as exc:
            raise HTTPException(409, str(exc)) from None
        return _public(job, settings)

    def _file(job_id: str, column: str) -> FileResponse:
        job = load(job_id)
        if not job[column]:
            raise HTTPException(404, "Not available yet.")
        return FileResponse(service().job_dir(job_id) / job[column])

    @app.get("/api/jobs/{job_id}/audio")
    def get_audio(job_id: str) -> FileResponse:
        return _file(job_id, "audio_file")

    @app.get("/api/jobs/{job_id}/video")
    def get_video(job_id: str) -> FileResponse:
        return _file(job_id, "video_file")

    return app
