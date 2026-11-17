"""Job lifecycle: voice generation, the approval gate, video submission, and
the poller that collects finished videos and recovers after a restart.

Charging (T-303, T-304; HLD §5.2): every status change that moves money passes its ledger step to
`JobStore.transition` (or `create`), which runs it in the same transaction as the compare-and-set
UPDATE, so a job's status and its ledger entries commit together or not at all (backend rule 3).
Only `app.wallet.ledger` writes the wallet tables (rule 1)."""

import asyncio
import logging
import math
import shutil
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from PIL import Image
from sqlalchemy import Connection

from ..core.config import Settings
from ..providers import VIDEO_LIFETIME_SECONDS, Provider, ProviderError
from ..scripts import service as script_library
from ..wallet import ledger
from . import db
from .db import JobStore

log = logging.getLogger("avatar")

_IMAGE_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


# Letters of the alphabets used by the non-English languages. Letters only:
# Punjabi text shares its full stop (the danda) with the Hindi Unicode block.
_SCRIPT_RANGES = {"Hindi": ("\u0904", "\u0939"), "Punjabi": ("\u0a05", "\u0a39")}


class ValidationError(Exception):
    """A create-job input is not acceptable. `field` names the input as the client sends it
    (`image`, `script` or `language`) so the interface can show the message under it."""

    def __init__(self, message: str, field: str) -> None:
        super().__init__(message)
        self.field = field


class Conflict(Exception):
    pass


class JobNotFound(Exception):
    """No such job for this user: it does not exist, is someone else's, or has no owner."""


class NotEnoughCredits(Exception):
    """The customer has fewer available credits than the step costs. Nothing was written. The
    message states both amounts, so the browser never computes money (HTTP 402)."""


def video_price(duration_seconds: float, credits_per_second: int) -> int:
    """`ceil(seconds × rate)` in whole credits (D-006, D-014). The measured duration is a float;
    it is read through its shortest decimal form so float error cannot add a credit
    (0.15 × 20 is 3.0000000000000004 in floating point, which would round up to 4)."""
    return math.ceil(Decimal(repr(duration_seconds)) * credits_per_second)


def _voice_shortfall(required: int, available: int) -> str:
    return f"Generating a voice costs {required} credits. You have {available}."


# A wallet step, given the job's row as read inside the status-change transaction.
_JobLedger = Callable[[Connection, dict], object]


def _voice_return(conn: Connection, job: dict) -> None:
    ledger.voice_return(conn, job["user_id"], job["id"])


def _hold(conn: Connection, job: dict) -> None:
    # The attempt was just increased by the same UPDATE; each approval has its own hold
    # reference (D-039). The amount is the price stored when the voice was ready (D-006).
    ledger.hold(
        conn, job["user_id"], job["id"], job["price_credits"], attempt=job["approve_attempt"]
    )


def _capture(conn: Connection, job: dict) -> None:
    ledger.capture(conn, job["user_id"], job["id"], attempt=job["approve_attempt"])


def _release(conn: Connection, job: dict) -> None:
    ledger.release(conn, job["user_id"], job["id"], attempt=job["approve_attempt"])


def _wallet(job_id: str, step: _JobLedger) -> db.LedgerStep:
    """The ledger step for one status change. It reads the job's row on the transaction's own
    connection, after the compare-and-set UPDATE, so the user, price and approval attempt are
    the values this transaction commits, never a stale earlier read. A job with no owner (made
    before accounts, T-204) is never charged: the step does nothing."""

    def run(conn: Connection) -> None:
        job = db.read_job(conn, job_id)
        if job["user_id"] is None:
            return
        step(conn, job)

    return run


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

    def check_can_afford_voice(self, user_id: str) -> None:
        """Read-only check that the customer can pay for a voice, so a customer without credits
        gets 402 before any input error (route order: 401, 403, 402, 422). The charge inside
        the job's creation transaction stays the real check."""
        price = self.settings.voice_price_credits
        available = ledger.get_wallet(self.store.engine, user_id).available_credits
        if available < price:
            raise NotEnoughCredits(_voice_shortfall(price, available))

    def _clean_image(self, raw: bytes) -> tuple[bytes, str]:
        """Validate an upload and re-encode it, so only pixels we decoded
        ourselves are stored or sent to the provider."""
        if not raw:
            raise ValidationError("The image file is empty. Choose a photo and try again.", "image")
        if len(raw) > self.settings.max_image_mb * 1024 * 1024:
            raise ValidationError(
                f"The image is larger than {self.settings.max_image_mb} MB. "
                "Choose a smaller photo.",
                "image",
            )
        try:
            image = Image.open(BytesIO(raw))
            image_format = image.format
            image.load()
        except Exception:
            raise ValidationError(
                "The file is not a readable image. Choose a JPEG, PNG or WebP photo.", "image"
            ) from None
        if image_format not in _IMAGE_FORMATS:
            raise ValidationError("Use a JPEG, PNG or WebP image.", "image")
        if min(image.size) < self.settings.min_image_side_px:
            raise ValidationError(
                f"The image must be at least {self.settings.min_image_side_px} pixels on each "
                "side. Choose a larger photo.",
                "image",
            )
        width, height = image.size
        if max(width, height) > self.settings.max_image_aspect_ratio * min(width, height):
            raise ValidationError(
                "The photo is too tall or too wide. Crop it so one side is at most "
                f"{self.settings.max_image_aspect_ratio:g} times the other.",
                "image",
            )
        out = BytesIO()
        if image_format == "JPEG":
            image.convert("RGB").save(out, "JPEG", quality=95)
        else:
            image.save(out, image_format)
        return out.getvalue(), _IMAGE_FORMATS[image_format]

    # ---- step 1: create the job and generate the voice ------------------

    def create_job(
        self, user_id: str, image_bytes: bytes, script: str, language: str, consent_version: str
    ) -> dict:
        """Create the job and charge the voice. `consent_version` is stored with the time in the
        same transaction (R-14, D-045); the route has already checked it is the current one.

        R-43, R-51: in that same transaction the script is saved to the customer's library (or an
        identical live one is touched) and its id stored in `jobs.script_id`; if any check or the
        voice charge fails, no script is saved. Script text is never logged."""
        script = script.strip()
        if not script:
            raise ValidationError("The script is empty. Type what the avatar should say.", "script")
        if len(script) > self.settings.max_script_chars:
            raise ValidationError(
                f"The script is longer than {self.settings.max_script_chars} characters. "
                "Shorten it and try again.",
                "script",
            )
        if language not in self.settings.languages:
            raise ValidationError(
                f"Language must be one of: {', '.join(self.settings.languages)}. "
                "Choose one from the list.",
                "language",
            )
        # A voice model reading a script it does not know produces paid-for
        # nonsense, so a script in another language's alphabet is refused.
        for name, (first, last) in _SCRIPT_RANGES.items():
            if name != language and any(first <= ch <= last for ch in script):
                raise ValidationError(
                    f"The script is written in {name}, but the selected language is "
                    f"{language}. Select {name} in the language list and try again.",
                    "script",
                )
        clean, extension = self._clean_image(image_bytes)

        job_id = uuid.uuid4().hex
        folder = self.job_dir(job_id)
        image_file = f"image.{extension}"
        price = self.settings.voice_price_credits

        def save_script(conn: Connection) -> str:
            return script_library.save_or_touch(conn, user_id, language, script)

        def charge_voice(conn: Connection) -> None:
            # HLD §5.2, first row (D-038): the job row and its voice charge commit together.
            ledger.voice_charge(conn, user_id, job_id, price)

        folder.mkdir(parents=True)
        try:
            (folder / image_file).write_bytes(clean)
            job = self.store.create(
                job_id,
                user_id,
                language,
                script,
                image_file,
                ledger=charge_voice,
                consent_version=consent_version,
                save_script=save_script,
            )
        except BaseException as exc:
            # Nothing was committed, so leave nothing on disk either.
            shutil.rmtree(folder, ignore_errors=True)
            if isinstance(exc, ledger.InsufficientCredits):
                raise NotEnoughCredits(_voice_shortfall(exc.required, exc.available)) from None
            raise
        self._spawn(self._generate_audio(job_id, script, language))
        return job

    async def _generate_audio(self, job_id: str, script: str, language: str) -> None:
        try:
            speech = await self.provider.synthesize_speech(script, language)
        except ProviderError as exc:
            # A clear failure, no voice delivered: return the voice charge (HLD §5.2, D-038).
            log.exception("voice generation failed for %s", job_id)
            self.store.transition(
                job_id,
                db.AUDIO_GENERATING,
                db.FAILED,
                ledger=_wallet(job_id, _voice_return),
                error=str(exc),
            )
            return
        except Exception:
            # Not a provider-reported failure, so whether fal.ai made (and billed) a voice is
            # unknown. No voice reached the customer, so the owner's voice rule applies (D-048):
            # the 10 credits are returned. The job is flagged, because the company may have paid.
            log.exception("voice generation failed for %s", job_id)
            self.store.transition(
                job_id,
                db.AUDIO_GENERATING,
                db.FAILED,
                ledger=_wallet(job_id, _voice_return),
                needs_review=True,
                error="Voice generation failed. The 10 credits were returned; please try again.",
            )
            return
        audio_file = f"audio.{speech.extension}"
        (self.job_dir(job_id) / audio_file).write_bytes(speech.data)
        limit = self.settings.max_audio_seconds
        if not speech.duration_seconds > 0:
            # No usable voice was delivered (it would also price the video at 0 credits, which
            # cannot be held). Treated as a clear failure: the voice charge is returned (D-038).
            log.error("voice for %s has no measurable length", job_id)
            self.store.transition(
                job_id,
                db.AUDIO_GENERATING,
                db.FAILED,
                ledger=_wallet(job_id, _voice_return),
                error="The voice came out empty. Nothing was charged for it; please try again.",
            )
            return
        if speech.duration_seconds > limit:
            # Owner decision D-040 (amends D-038): a voice longer than the limit was delivered,
            # so its charge is KEPT (no voice_return), and its audio file stays on the job.
            self.store.transition(
                job_id,
                db.AUDIO_GENERATING,
                db.FAILED,
                audio_file=audio_file,
                audio_duration_seconds=speech.duration_seconds,
                error=(
                    f"The voice came out at {speech.duration_seconds:.1f} seconds, longer than "
                    f"the allowed {limit:.0f} seconds. Shorten the script and start over."
                ),
            )
            return
        # T-303: the video price is fixed now and stored on the job; approval holds this amount.
        self.store.transition(
            job_id,
            db.AUDIO_GENERATING,
            db.AUDIO_READY,
            audio_file=audio_file,
            audio_duration_seconds=speech.duration_seconds,
            price_credits=video_price(speech.duration_seconds, self.settings.credits_per_second),
        )

    # ---- step 2: approval gate, then the paid video submission ----------

    def approve_audio(self, user_id: str, job_id: str) -> dict:
        """Only the first approval of a job wins; any repeat or concurrent
        click finds the job already past `audio_ready` and gets a Conflict.
        The job must belong to `user_id`; otherwise it is reported as not found (R-12).
        The status change, the next approval attempt and the hold of the stored price commit
        together; with too few credits nothing changes and NotEnoughCredits is raised."""
        if self.store.get_owned(job_id, user_id) is None:
            raise JobNotFound(job_id)
        try:
            moved = self.store.transition(
                job_id,
                db.AUDIO_READY,
                db.VIDEO_SUBMITTING,
                ledger=_wallet(job_id, _hold),
                error=None,
                approve_attempt=db.jobs.c.approve_attempt + 1,
            )
        except ledger.InsufficientCredits as exc:
            # Rolled back: the job is still audio_ready and nothing was held.
            raise NotEnoughCredits(
                f"This video costs {exc.required} credits. You have {exc.available}."
            ) from None
        if not moved:
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
            # Nothing has been billed yet, so the hold is released and the user may simply
            # approve again (a new attempt, D-039).
            log.exception("input upload failed for %s", job_id)
            message = str(exc) if isinstance(exc, ProviderError) else "Uploading inputs failed."
            self.store.transition(
                job_id,
                db.VIDEO_SUBMITTING,
                db.AUDIO_READY,
                ledger=_wallet(job_id, _release),
                error=f"{message} Nothing was charged; you can approve again.",
            )
            return
        try:
            request_id = await self.provider.submit_video(image_ref, audio_ref)
        except ProviderError as exc:
            # A definite refusal (for example an exhausted balance): nothing was
            # started, so release the hold, keep the paid-for audio and let the user
            # approve again.
            log.warning("video submission refused for %s: %s", job_id, exc)
            self.store.transition(
                job_id,
                db.VIDEO_SUBMITTING,
                db.AUDIO_READY,
                ledger=_wallet(job_id, _release),
                error=str(exc),
            )
            return
        except Exception:
            # The submission may or may not have reached the provider, so it is
            # never retried automatically: a retry could be charged twice. Unknown
            # outcome: the hold is captured and the job flagged (Q-19, D-005; rule 5).
            log.exception("video submission failed for %s", job_id)
            self.store.transition(
                job_id,
                db.VIDEO_SUBMITTING,
                db.FAILED,
                ledger=_wallet(job_id, _capture),
                needs_review=True,
                error=(
                    "Submitting the video failed and it is unknown whether the provider "
                    "accepted it. It was not retried, to avoid a double charge."
                ),
            )
            return
        # Accepted: the hold stays until the video is delivered or clearly fails.
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
        than re-run, because re-running could repeat a paid request.

        Both are unknown outcomes of a paid call and are flagged for staff. A cut-off voice
        delivered nothing to the customer, so its 10 credits are returned (D-048). A cut-off
        video submission may have started a paid video, so its hold is captured (Q-19, D-005)."""
        steps: tuple[tuple[str, str, _JobLedger | None], ...] = (
            (
                db.AUDIO_GENERATING,
                "Voice generation was interrupted by a server restart. "
                "The 10 credits were returned.",
                _voice_return,  # D-048: no voice reached the customer
            ),
            (
                db.VIDEO_SUBMITTING,
                "Video submission was interrupted by a server restart and it is unknown whether "
                "the provider accepted it. It was not retried, to avoid a double charge.",
                _capture,
            ),
        )
        for status, message, step in steps:
            for job in self.store.list_by_status(status):
                # One job that cannot be settled (for example one left in flight from before
                # migration 0005, with no hold) must not stop the server from starting. Its
                # change rolled back; it is logged and tried again at the next start.
                try:
                    self.store.transition(
                        job["id"],
                        status,
                        db.FAILED,
                        ledger=_wallet(job["id"], step) if step else None,
                        needs_review=True,
                        error=message,
                    )
                except Exception:
                    log.exception("could not recover interrupted job %s", job["id"])

    async def poll_once(self) -> None:
        for job in self.store.list_by_status(db.VIDEO_GENERATING):
            # One job's failure (for example a ledger error) must not stop the others from being
            # collected. Its status change rolled back, so it is simply tried again next cycle.
            try:
                await self._poll_job(job)
            except Exception:
                log.exception("collecting the video failed for %s; will retry", job["id"])

    async def _poll_job(self, job: dict) -> None:
        job_id = job["id"]
        try:
            poll = await self.provider.poll_video(job["provider_request_id"])
        except Exception:
            log.exception("polling failed for %s; will retry", job_id)
            poll = None
        if poll is not None and poll.state == "done":
            video: dict[str, str] = {}
            if poll.url:
                # D-065 (R-24, R-74): keep fal's link, not the file; fal keeps it 30 days.
                expires = datetime.now(timezone.utc) + timedelta(seconds=VIDEO_LIFETIME_SECONDS)
                video["video_url"] = poll.url
                video["video_expires_at"] = expires.isoformat(timespec="seconds")
            else:
                (self.job_dir(job_id) / "video.mp4").write_bytes(poll.data or b"")
                video["video_file"] = "video.mp4"
            # Delivered: take the held price. A repeated or concurrent poll finds the job
            # no longer video_generating, so the capture happens once.
            self.store.transition(
                job_id,
                db.VIDEO_GENERATING,
                db.COMPLETED,
                ledger=_wallet(job_id, _capture),
                **video,
            )
        elif poll is not None and poll.state == "failed":
            # A clear failure reported by the provider: release the hold.
            self.store.transition(
                job_id,
                db.VIDEO_GENERATING,
                db.FAILED,
                ledger=_wallet(job_id, _release),
                error=poll.error,
            )
        else:
            started = datetime.fromisoformat(job["video_started_at"])
            waited = (datetime.now(timezone.utc) - started).total_seconds()
            if waited > self.settings.video_timeout_seconds:
                # A timeout is a clear failure (HLD §5.2): release the hold.
                self.store.transition(
                    job_id,
                    db.VIDEO_GENERATING,
                    db.FAILED,
                    ledger=_wallet(job_id, _release),
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
