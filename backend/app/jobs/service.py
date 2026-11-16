"""Job lifecycle: voice generation, the approval gate, video submission, and
the poller that collects finished videos and recovers after a restart."""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from PIL import Image

from ..core.config import Settings
from ..providers import Provider, ProviderError
from . import db
from .db import JobStore

log = logging.getLogger("avatar")

_IMAGE_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


# Letters of the alphabets used by the non-English languages. Letters only:
# Punjabi text shares its full stop (the danda) with the Hindi Unicode block.
_SCRIPT_RANGES = {"Hindi": ("\u0904", "\u0939"), "Punjabi": ("\u0a05", "\u0a39")}


class ValidationError(Exception):
    pass


class Conflict(Exception):
    pass


class JobService:
    def __init__(self, settings: Settings, store: JobStore, provider: Provider):
        self.settings = settings
        self.store = store
        self.provider = provider
        self._tasks: set[asyncio.Task] = set()

    # ---- helpers -------------------------------------------------------

    def job_dir(self, job_id: str) -> Path:
        return self.settings.jobs_dir / job_id

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _clean_image(self, raw: bytes) -> tuple[bytes, str]:
        """Validate an upload and re-encode it, so only pixels we decoded
        ourselves are stored or sent to the provider."""
        if not raw:
            raise ValidationError("The image file is empty.")
        if len(raw) > self.settings.max_image_mb * 1024 * 1024:
            raise ValidationError(f"The image is larger than {self.settings.max_image_mb} MB.")
        try:
            image = Image.open(BytesIO(raw))
            image_format = image.format
            image.load()
        except Exception:
            raise ValidationError("The file is not a readable image.") from None
        if image_format not in _IMAGE_FORMATS:
            raise ValidationError("Use a JPEG, PNG or WebP image.")
        if min(image.size) < self.settings.min_image_side_px:
            raise ValidationError(
                f"The image must be at least {self.settings.min_image_side_px} pixels on each side."
            )
        out = BytesIO()
        if image_format == "JPEG":
            image.convert("RGB").save(out, "JPEG", quality=95)
        else:
            image.save(out, image_format)
        return out.getvalue(), _IMAGE_FORMATS[image_format]

    # ---- step 1: create the job and generate the voice ------------------

    def create_job(self, image_bytes: bytes, script: str, language: str) -> dict:
        script = script.strip()
        if not script:
            raise ValidationError("The script is empty.")
        if len(script) > self.settings.max_script_chars:
            raise ValidationError(
                f"The script is longer than {self.settings.max_script_chars} characters."
            )
        if language not in self.settings.languages:
            raise ValidationError(f"Language must be one of: {', '.join(self.settings.languages)}.")
        # A voice model reading a script it does not know produces paid-for
        # nonsense, so a script in another language's alphabet is refused.
        for name, (first, last) in _SCRIPT_RANGES.items():
            if name != language and any(first <= ch <= last for ch in script):
                raise ValidationError(
                    f"The script is written in {name}, but the selected language is "
                    f"{language}. Select {name} in the language list and try again."
                )
        clean, extension = self._clean_image(image_bytes)

        job_id = uuid.uuid4().hex
        self.job_dir(job_id).mkdir(parents=True)
        image_file = f"image.{extension}"
        (self.job_dir(job_id) / image_file).write_bytes(clean)
        job = self.store.create(job_id, language, script, image_file)
        self._spawn(self._generate_audio(job_id, script, language))
        return job

    async def _generate_audio(self, job_id: str, script: str, language: str) -> None:
        try:
            speech = await self.provider.synthesize_speech(script, language)
        except Exception as exc:
            log.exception("voice generation failed for %s", job_id)
            message = str(exc) if isinstance(exc, ProviderError) else "Voice generation failed."
            self.store.transition(job_id, db.AUDIO_GENERATING, db.FAILED, error=message)
            return
        audio_file = f"audio.{speech.extension}"
        (self.job_dir(job_id) / audio_file).write_bytes(speech.data)
        limit = self.settings.max_audio_seconds
        if speech.duration_seconds > limit:
            self.store.transition(
                job_id,
                db.AUDIO_GENERATING,
                db.FAILED,
                audio_file=audio_file,
                audio_duration_seconds=speech.duration_seconds,
                error=(
                    f"The voice came out at {speech.duration_seconds:.1f} seconds; the limit is "
                    f"{limit:.0f} seconds. Shorten the script and start over."
                ),
            )
            return
        self.store.transition(
            job_id,
            db.AUDIO_GENERATING,
            db.AUDIO_READY,
            audio_file=audio_file,
            audio_duration_seconds=speech.duration_seconds,
        )

    # ---- step 2: approval gate, then the paid video submission ----------

    def approve_audio(self, job_id: str) -> dict:
        """Only the first approval of a job wins; any repeat or concurrent
        click finds the job already past `audio_ready` and gets a Conflict."""
        if not self.store.transition(job_id, db.AUDIO_READY, db.VIDEO_SUBMITTING, error=None):
            raise Conflict("This job is not waiting for audio approval.")
        self._spawn(self._submit_video(job_id))
        return self.store.get(job_id)  # type: ignore[return-value]

    async def _submit_video(self, job_id: str) -> None:
        job = self.store.get(job_id)
        assert job is not None
        folder = self.job_dir(job_id)
        try:
            image_ref, audio_ref = await self.provider.upload_inputs(
                folder / job["image_file"], folder / job["audio_file"]
            )
        except Exception as exc:
            # Nothing has been billed yet, so the user may simply approve again.
            log.exception("input upload failed for %s", job_id)
            message = str(exc) if isinstance(exc, ProviderError) else "Uploading inputs failed."
            self.store.transition(
                job_id,
                db.VIDEO_SUBMITTING,
                db.AUDIO_READY,
                error=f"{message} Nothing was charged; you can approve again.",
            )
            return
        try:
            request_id = await self.provider.submit_video(image_ref, audio_ref)
        except ProviderError as exc:
            # A definite refusal (for example an exhausted balance): nothing was
            # started, so keep the paid-for audio and let the user approve again.
            log.warning("video submission refused for %s: %s", job_id, exc)
            self.store.transition(job_id, db.VIDEO_SUBMITTING, db.AUDIO_READY, error=str(exc))
            return
        except Exception:
            # The submission may or may not have reached the provider, so it is
            # never retried automatically: a retry could be charged twice.
            log.exception("video submission failed for %s", job_id)
            self.store.transition(
                job_id,
                db.VIDEO_SUBMITTING,
                db.FAILED,
                error=(
                    "Submitting the video failed and it is unknown whether the provider "
                    "accepted it. It was not retried, to avoid a double charge."
                ),
            )
            return
        self.store.transition(
            job_id,
            db.VIDEO_SUBMITTING,
            db.VIDEO_GENERATING,
            provider_request_id=request_id,
            video_started_at=db.now_iso(),
        )

    # ---- step 3: collect results; also what resumes work after a restart -

    def recover_interrupted(self) -> None:
        """Run once at startup. Jobs already submitted keep their request id and
        are picked up by the poller. Jobs cut off mid-call are failed rather
        than re-run, because re-running could repeat a paid request."""
        for status, message in (
            (db.AUDIO_GENERATING, "Voice generation was interrupted by a server restart."),
            (
                db.VIDEO_SUBMITTING,
                "Video submission was interrupted by a server restart and it is unknown whether "
                "the provider accepted it. It was not retried, to avoid a double charge.",
            ),
        ):
            for job in self.store.list_by_status(status):
                self.store.transition(job["id"], status, db.FAILED, error=message)

    async def poll_once(self) -> None:
        for job in self.store.list_by_status(db.VIDEO_GENERATING):
            job_id = job["id"]
            try:
                poll = await self.provider.poll_video(job["provider_request_id"])
            except Exception:
                log.exception("polling failed for %s; will retry", job_id)
                poll = None
            if poll is not None and poll.state == "done":
                (self.job_dir(job_id) / "video.mp4").write_bytes(poll.data or b"")
                self.store.transition(
                    job_id, db.VIDEO_GENERATING, db.COMPLETED, video_file="video.mp4"
                )
            elif poll is not None and poll.state == "failed":
                self.store.transition(job_id, db.VIDEO_GENERATING, db.FAILED, error=poll.error)
            else:
                started = datetime.fromisoformat(job["video_started_at"])
                waited = (datetime.now(timezone.utc) - started).total_seconds()
                if waited > self.settings.video_timeout_seconds:
                    self.store.transition(
                        job_id,
                        db.VIDEO_GENERATING,
                        db.FAILED,
                        error=(
                            f"No video after {waited / 60:.0f} minutes. Provider request id: "
                            f"{job['provider_request_id']}."
                        ),
                    )

    async def run_poller(self) -> None:
        while True:
            try:
                await self.poll_once()
            except Exception:
                log.exception("poller iteration failed")
            await asyncio.sleep(self.settings.poll_interval_seconds)
