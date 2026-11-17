"""T-303, T-304: pricing, and every row of the charging table (HLD §5.2) as one transaction.

Each row test asserts the job's status AND its ledger entries AND the wallet balance together,
and that the stored balance still equals the ledger (`invariant_holds`). Requirements: R-09
(prices in credits), R-10 (each charge happens once, tied to its job), R-56 (status changes are
compare-and-set; a paid step never repeats).

Mock provider and stubs only; free; no network."""

import asyncio
import threading
import time
from dataclasses import replace
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import Engine, text

from app.core.config import Settings
from app.jobs import db
from app.jobs.db import JobStore
from app.jobs.service import Conflict, JobService, NotEnoughCredits, video_price
from app.main import create_app
from app.providers import MockProvider, ProviderError, VideoPoll
from app.wallet import ledger

HTTPS = "https://testserver"
VOICE = 10  # Settings.voice_price_credits (D-038)
RATE = 20  # Settings.credits_per_second (D-006)
# The mock speaks 15 characters a second: 32 characters is 2.133… s, priced ceil(42.67) = 43.
SCRIPT = "Hello there, this is a test run."
PRICE = 43


def png() -> bytes:
    out = BytesIO()
    Image.new("RGB", (512, 512), "teal").save(out, "PNG")
    return out.getvalue()


@pytest.fixture
def settings(tmp_path, database_url) -> Settings:
    return replace(
        Settings(),
        provider="mock",
        data_dir=tmp_path,
        poll_interval_seconds=0.05,
        database_url=database_url,
    )


class Charging:
    """A service over the test's database, its owner, and readers for the money."""

    def __init__(self, settings: Settings, provider, owner: str):
        self.store = JobStore(settings.database_url)
        self.service = JobService(settings, self.store, provider or MockProvider(settings))
        self.owner = owner

    @property
    def provider(self):
        return self.service.provider

    @property
    def engine(self) -> Engine:
        return self.store.engine

    def entries(self, user: str | None = None) -> list[tuple[str, str, int, int]]:
        """(kind, ref_id, credits, reserved_delta) of the user's entries, sorted."""
        with self.engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT kind, ref_id, credits, reserved_delta FROM ledger_entries "
                    "WHERE user_id = :u"
                ),
                {"u": user or self.owner},
            ).all()
        return sorted(tuple(r) for r in rows)  # type: ignore[misc]

    def all_entries(self) -> int:
        with self.engine.connect() as conn:
            return conn.execute(text("SELECT count(*) FROM ledger_entries")).scalar_one()

    def wallet(self) -> tuple[int, int]:
        w = ledger.get_wallet(self.engine, self.owner)
        return w.balance_credits, w.reserved_credits

    def invariant(self) -> bool:
        with self.engine.connect() as conn:
            return ledger.invariant_holds(conn, self.owner)

    def job(self, job_id: str) -> dict:
        return self.store.get(job_id)  # type: ignore[return-value]

    async def drain(self) -> None:
        while self.service._tasks:
            await asyncio.gather(*list(self.service._tasks), return_exceptions=True)

    async def ready_job(self, script: str = SCRIPT) -> str:
        job = self.service.create_job(self.owner, png(), script, "English")
        await self.drain()
        return job["id"]

    async def approved_job(self) -> str:
        job_id = await self.ready_job()
        self.service.approve_audio(self.owner, job_id)
        await self.drain()
        return job_id


_open: list[Charging] = []


@pytest.fixture
def charging(settings, seed_user, grant):
    """`charging(credits=1000, provider=None, settings=settings)`: a Charging whose owner has
    `credits` (none if 0)."""

    def make(credits: int = 1000, provider=None, cfg: Settings | None = None) -> Charging:
        owner = seed_user(settings.database_url)
        c = Charging(cfg or settings, provider, owner)
        _open.append(c)
        if credits:
            grant(c.engine, owner, credits)
        return c

    yield make
    while _open:
        _open.pop().store.close()


def hold(job_id: str, price: int = PRICE, attempt: int = 1):
    return ("hold", f"{job_id}#{attempt}", 0, price)


def capture(job_id: str, price: int = PRICE, attempt: int = 1):
    return ("capture", f"{job_id}#{attempt}", -price, -price)


def release(job_id: str, price: int = PRICE, attempt: int = 1):
    return ("release", f"{job_id}#{attempt}", 0, -price)


def voice_charge(job_id: str):
    return ("voice_charge", job_id, -VOICE, 0)


def voice_return(job_id: str):
    return ("voice_return", job_id, VOICE, 0)


def without_grants(entries):
    return [e for e in entries if e[0] != "grant"]


# ---- providers that fail in chosen ways ----------------------------------------------------


class VoiceRefused(MockProvider):
    async def synthesize_speech(self, text, language):
        raise ProviderError("Voice generation failed: refused")


class VoiceBroken(MockProvider):
    async def synthesize_speech(self, text, language):
        raise RuntimeError("connection reset mid-call")


class FlakyUpload(MockProvider):
    fail = True

    async def upload_inputs(self, image, audio):
        if self.fail:
            raise ProviderError("Uploading inputs failed: network")
        return await super().upload_inputs(image, audio)


class RefusedSubmit(MockProvider):
    async def submit_video(self, image_ref, audio_ref):
        raise ProviderError("Video generation was refused: balance exhausted.")


class UnknownSubmit(MockProvider):
    async def submit_video(self, image_ref, audio_ref):
        self.submit_count += 1
        raise TimeoutError("no response")


class ScriptedPolls(MockProvider):
    """Every poll returns `outcome`, after yielding once so concurrent pollers interleave."""

    def __init__(self, settings, outcome: VideoPoll):
        super().__init__(settings)
        self.outcome = outcome
        self.polls = 0

    async def poll_video(self, request_id):
        self.polls += 1
        await asyncio.sleep(0)
        return self.outcome


DONE = VideoPoll("done", data=b"video-bytes")


# ---- one test per row of HLD §5.2 -----------------------------------------------------------


def test_row_create_charges_the_voice_with_the_job(charging):
    """R-10, R-09: submit → audio_generating with voice_charge 10, in one transaction."""

    async def run():
        c = charging(credits=100)
        job = c.service.create_job(c.owner, png(), SCRIPT, "English")
        assert c.job(job["id"])["status"] == db.AUDIO_GENERATING
        assert without_grants(c.entries()) == [voice_charge(job["id"])]
        assert c.wallet() == (90, 0)
        assert c.invariant()
        await c.drain()

    asyncio.run(run())


def test_row_voice_failure_returns_the_voice_charge(charging, settings):
    """R-10: a clear voice failure → failed with voice_return; the customer pays nothing."""

    async def run():
        c = charging(credits=100, provider=VoiceRefused(settings))
        job_id = await c.ready_job()
        job = c.job(job_id)
        assert (job["status"], job["needs_review"]) == (db.FAILED, False)
        assert without_grants(c.entries()) == sorted([voice_charge(job_id), voice_return(job_id)])
        assert c.wallet() == (100, 0)
        assert c.invariant()

    asyncio.run(run())


def test_row_voice_unknown_outcome_keeps_the_charge_and_flags(charging, settings):
    """R-10: a voice call that fails without a provider verdict has an unknown outcome → failed,
    flagged, voice charge kept (the owner's rule, Q-19, applied to the voice)."""

    async def run():
        c = charging(credits=100, provider=VoiceBroken(settings))
        job_id = await c.ready_job()
        job = c.job(job_id)
        assert (job["status"], job["needs_review"]) == (db.FAILED, True)
        assert without_grants(c.entries()) == [voice_charge(job_id)]
        assert c.wallet() == (90, 0)
        assert c.invariant()

    asyncio.run(run())


def test_row_voice_over_the_limit_keeps_the_charge_and_the_audio(charging):
    """R-10 (owner decision D-040, amends D-038): a voice longer than the limit was delivered →
    failed, the voice charge kept (no voice_return), the audio file kept on the job, and the
    customer told the voice was too long."""

    async def run():
        c = charging(credits=100)
        c.provider.chars_per_second = 12.0  # 400 characters → 33 s, over the 30 s limit
        job_id = await c.ready_job(script="a" * 400)
        job = c.job(job_id)
        assert job["status"] == db.FAILED
        assert "longer than the allowed 30 seconds" in job["error"]
        assert job["price_credits"] is None
        assert job["audio_file"]
        assert (c.service.job_dir(job_id) / job["audio_file"]).stat().st_size > 0
        assert without_grants(c.entries()) == [voice_charge(job_id)]
        assert c.wallet() == (90, 0)
        assert c.invariant()
        with pytest.raises(Conflict):
            c.service.approve_audio(c.owner, job_id)

    asyncio.run(run())


def test_row_voice_ready_fixes_the_price_and_moves_no_money(charging):
    """R-09 (T-303): voice ready → audio_ready with price_credits = ceil(seconds × 20) stored as
    an int; no ledger entry."""

    async def run():
        c = charging(credits=100)
        job_id = await c.ready_job()
        job = c.job(job_id)
        assert job["status"] == db.AUDIO_READY
        assert job["price_credits"] == PRICE
        assert isinstance(job["price_credits"], int)
        assert job["price_credits"] == video_price(job["audio_duration_seconds"], RATE)
        assert without_grants(c.entries()) == [voice_charge(job_id)]
        assert c.wallet() == (90, 0)
        assert c.invariant()

    asyncio.run(run())


def test_row_approve_holds_the_stored_price(charging):
    """R-10, R-56: approve → video_submitting, approve_attempt 1, hold of the stored price under
    `<job>#1`, all in one transaction."""

    async def run():
        c = charging(credits=100)
        job_id = await c.ready_job()
        job = c.service.approve_audio(c.owner, job_id)
        assert (job["status"], job["approve_attempt"]) == (db.VIDEO_SUBMITTING, 1)
        assert without_grants(c.entries()) == sorted([voice_charge(job_id), hold(job_id)])
        assert c.wallet() == (90, PRICE)
        assert c.invariant()
        await c.drain()

    asyncio.run(run())


def test_row_upload_failure_releases_the_hold(charging, settings):
    """R-10: upload fails cleanly → back to audio_ready with release."""

    async def run():
        c = charging(credits=100, provider=FlakyUpload(settings))
        job_id = await c.approved_job()
        job = c.job(job_id)
        assert (job["status"], job["needs_review"]) == (db.AUDIO_READY, False)
        assert without_grants(c.entries()) == sorted(
            [voice_charge(job_id), hold(job_id), release(job_id)]
        )
        assert c.wallet() == (90, 0)
        assert c.provider.submit_count == 0
        assert c.invariant()

    asyncio.run(run())


def test_row_refused_submission_releases_the_hold(charging, settings):
    """R-10: fal.ai definitely refuses → back to audio_ready with release."""

    async def run():
        c = charging(credits=100, provider=RefusedSubmit(settings))
        job_id = await c.approved_job()
        job = c.job(job_id)
        assert (job["status"], job["needs_review"]) == (db.AUDIO_READY, False)
        assert "balance exhausted" in job["error"]
        assert without_grants(c.entries()) == sorted(
            [voice_charge(job_id), hold(job_id), release(job_id)]
        )
        assert c.wallet() == (90, 0)
        assert c.invariant()

    asyncio.run(run())


def test_row_unknown_submission_captures_and_flags(charging, settings):
    """R-10, R-56: submission outcome unknown → failed, needs_review, capture (Q-19, D-005);
    never retried."""

    async def run():
        c = charging(credits=100, provider=UnknownSubmit(settings))
        job_id = await c.approved_job()
        job = c.job(job_id)
        assert (job["status"], job["needs_review"]) == (db.FAILED, True)
        assert "double charge" in job["error"]
        assert without_grants(c.entries()) == sorted(
            [voice_charge(job_id), hold(job_id), capture(job_id)]
        )
        assert c.wallet() == (90 - PRICE, 0)
        assert c.provider.submit_count == 1
        with pytest.raises(Conflict):
            c.service.approve_audio(c.owner, job_id)
        assert c.invariant()

    asyncio.run(run())


def test_row_accepted_submission_keeps_the_hold(charging):
    """R-10: fal.ai accepts → video_generating; the hold stays, nothing else moves."""

    async def run():
        c = charging(credits=100)
        job_id = await c.approved_job()
        job = c.job(job_id)
        assert job["status"] == db.VIDEO_GENERATING and job["provider_request_id"]
        assert without_grants(c.entries()) == sorted([voice_charge(job_id), hold(job_id)])
        assert c.wallet() == (90, PRICE)
        assert c.invariant()

    asyncio.run(run())


def test_row_downloaded_video_captures(charging, settings):
    """R-10: video downloaded → completed with capture of the held price."""

    async def run():
        c = charging(credits=100, provider=ScriptedPolls(settings, DONE))
        job_id = await c.approved_job()
        await c.service.poll_once()
        assert c.job(job_id)["status"] == db.COMPLETED
        assert without_grants(c.entries()) == sorted(
            [voice_charge(job_id), hold(job_id), capture(job_id)]
        )
        assert c.wallet() == (90 - PRICE, 0)
        assert c.invariant()

    asyncio.run(run())


def test_row_video_failure_releases(charging, settings):
    """R-10: the provider reports the video failed → failed with release."""

    async def run():
        failed = VideoPoll("failed", error="Video generation failed: x")
        c = charging(credits=100, provider=ScriptedPolls(settings, failed))
        job_id = await c.approved_job()
        await c.service.poll_once()
        job = c.job(job_id)
        assert (job["status"], job["needs_review"]) == (db.FAILED, False)
        assert without_grants(c.entries()) == sorted(
            [voice_charge(job_id), hold(job_id), release(job_id)]
        )
        assert c.wallet() == (90, 0)
        assert c.invariant()

    asyncio.run(run())


def test_row_video_timeout_releases(charging, settings):
    """R-10: no video within the timeout (a clear failure) → failed with release."""

    async def run():
        cfg = replace(settings, video_timeout_seconds=-1)
        c = charging(credits=100, provider=ScriptedPolls(cfg, VideoPoll("pending")), cfg=cfg)
        job_id = await c.approved_job()
        await c.service.poll_once()
        assert c.job(job_id)["status"] == db.FAILED
        assert without_grants(c.entries()) == sorted(
            [voice_charge(job_id), hold(job_id), release(job_id)]
        )
        assert c.wallet() == (90, 0)
        assert c.invariant()

    asyncio.run(run())


def test_row_restart_mid_submission_captures_and_flags(charging):
    """R-10, R-56: a restart finds the job in video_submitting (outcome unknown) → failed,
    needs_review, capture; nothing is resubmitted."""

    async def run():
        c = charging(credits=100)
        job_id = await c.ready_job()
        c.service.approve_audio(c.owner, job_id)
        for task in list(c.service._tasks):  # the process dies before the submission ends
            task.cancel()
        await c.drain()
        assert c.job(job_id)["status"] == db.VIDEO_SUBMITTING
        c.service.recover_interrupted()
        job = c.job(job_id)
        assert (job["status"], job["needs_review"]) == (db.FAILED, True)
        assert without_grants(c.entries()) == sorted(
            [voice_charge(job_id), hold(job_id), capture(job_id)]
        )
        assert c.wallet() == (90 - PRICE, 0)
        assert c.provider.submit_count == 0
        c.service.recover_interrupted()  # a second restart changes nothing
        assert len(c.entries()) == 4
        assert c.invariant()

    asyncio.run(run())


def test_row_restart_mid_voice_keeps_the_charge_and_flags(charging):
    """R-10: a restart finds the job in audio_generating (voice outcome unknown) → failed,
    needs_review, voice charge KEPT (the owner's unknown-outcome rule applied to the voice)."""

    async def run():
        c = charging(credits=100)
        job = c.service.create_job(c.owner, png(), SCRIPT, "English")
        for task in list(c.service._tasks):
            task.cancel()
        await c.drain()
        c.service.recover_interrupted()
        job = c.job(job["id"])
        assert (job["status"], job["needs_review"]) == (db.FAILED, True)
        assert without_grants(c.entries()) == [voice_charge(job["id"])]
        assert c.wallet() == (90, 0)
        assert c.invariant()

    asyncio.run(run())


# ---- not enough credits (402) --------------------------------------------------------------


def test_service_create_without_credits_leaves_no_job_and_no_files(charging):
    """R-10: the voice charge fails inside the creation transaction (as when another request
    spent the credits after the route's check) → NotEnoughCredits, no job row, no folder."""

    async def run():
        c = charging(credits=5)
        with pytest.raises(NotEnoughCredits, match="costs 10 credits. You have 5."):
            c.service.create_job(c.owner, png(), SCRIPT, "English")
        with c.engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM jobs")).scalar_one() == 0
        assert not list(c.service.settings.jobs_dir.glob("*"))
        assert c.wallet() == (5, 0)
        assert c.invariant()

    asyncio.run(run())


def test_approve_without_enough_credits_changes_nothing(charging):
    """R-10, R-56: approve with fewer credits than the price → NotEnoughCredits; still
    audio_ready, approve_attempt 0, no hold, nothing submitted."""

    async def run():
        c = charging(credits=VOICE + 40)  # 40 left after the voice; the video costs 43
        job_id = await c.ready_job()
        with pytest.raises(NotEnoughCredits) as err:
            c.service.approve_audio(c.owner, job_id)
        assert str(err.value) == f"This video costs {PRICE} credits. You have 40."
        job = c.job(job_id)
        assert (job["status"], job["approve_attempt"]) == (db.AUDIO_READY, 0)
        assert without_grants(c.entries()) == [voice_charge(job_id)]
        assert c.wallet() == (40, 0)
        assert c.provider.submit_count == 0
        assert c.invariant()

    asyncio.run(run())


def test_http_402_on_create_and_approve(settings, sign_up, grant):
    """R-10, R-09: POST /jobs with too few credits answers 402 insufficient_credits with the
    amounts, before any input error, and creates nothing; approve answers 402 and leaves the job
    audio_ready."""
    with TestClient(create_app(settings, start_poller=False), base_url=HTTPS) as client:
        user = sign_up(client)
        no_image = client.post("/api/v1/jobs", data={"script": "Hello.", "language": "English"})
        assert no_image.status_code == 402, no_image.text
        r = client.post(
            "/api/v1/jobs",
            files={"image": ("me.png", png(), "image/png")},
            data={"script": SCRIPT, "language": "English"},
        )
        assert r.status_code == 402, r.text
        assert r.json() == {
            "detail": "Generating a voice costs 10 credits. You have 0.",
            "code": "insufficient_credits",
        }
        engine = client.app.state.service.store.engine  # type: ignore[attr-defined]
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM jobs")).scalar_one() == 0
        assert not list(settings.jobs_dir.glob("*"))

        grant(client, user, VOICE + 1)
        r = client.post(
            "/api/v1/jobs",
            files={"image": ("me.png", png(), "image/png")},
            data={"script": SCRIPT, "language": "English"},
        )
        assert r.status_code == 201, r.text
        job_id = r.json()["id"]
        wait_for(client, job_id, "audio_ready")
        r = client.post(f"/api/v1/jobs/{job_id}/approve")
        assert r.status_code == 402, r.text
        assert r.json()["code"] == "insufficient_credits"
        assert r.json()["detail"] == f"This video costs {PRICE} credits. You have 1."
        assert client.get(f"/api/v1/jobs/{job_id}").json()["status"] == "audio_ready"


# ---- retries, repeats and races ------------------------------------------------------------


def test_approve_clean_failure_approve_again_complete(charging, settings):
    """R-10, R-56 (D-039): approve → upload fails (release #1) → approve again (hold #2) →
    delivered (capture #2). Two holds, one release, one capture; charged voice + price once."""

    async def run():
        provider = FlakyUpload(settings)
        c = charging(credits=100, provider=provider)
        job_id = await c.approved_job()
        assert c.job(job_id)["status"] == db.AUDIO_READY
        provider.fail = False
        provider.polls_before_done = 1
        c.service.approve_audio(c.owner, job_id)
        await c.drain()
        assert c.job(job_id)["approve_attempt"] == 2
        await c.service.poll_once()
        assert c.job(job_id)["status"] == db.COMPLETED
        assert without_grants(c.entries()) == sorted(
            [
                voice_charge(job_id),
                hold(job_id, attempt=1),
                release(job_id, attempt=1),
                hold(job_id, attempt=2),
                capture(job_id, attempt=2),
            ]
        )
        assert c.wallet() == (90 - PRICE, 0)
        assert ledger.job_charged_credits(c.engine, job_id) == VOICE + PRICE
        assert c.provider.submit_count == 1
        assert c.invariant()

    asyncio.run(run())


def test_polling_a_completed_job_again_captures_once(charging, settings):
    """R-10, R-56 (repeat): the poller step run again after completion, and two pollers on the
    same finished video at once, capture exactly once."""

    async def run():
        provider = ScriptedPolls(settings, DONE)
        c = charging(credits=100, provider=provider)
        job_id = await c.approved_job()
        await asyncio.gather(c.service.poll_once(), c.service.poll_once())
        assert provider.polls == 2  # both pollers saw the job as video_generating
        await c.service.poll_once()
        await c.service.poll_once()
        assert c.job(job_id)["status"] == db.COMPLETED
        assert [e for e in c.entries() if e[0] == "capture"] == [capture(job_id)]
        assert c.wallet() == (90 - PRICE, 0)
        assert c.invariant()

    asyncio.run(run())


def test_concurrent_approvals_hold_once(charging):
    """R-56, R-10 (race): many approvals of one job at once → one wins, the rest get Conflict;
    exactly one hold, under attempt 1."""

    async def run():
        c = charging(credits=100)
        job_id = await c.ready_job()
        spawned = []
        c.service._spawn = lambda coro: spawned.append(coro.close())  # type: ignore[method-assign]
        n = 8
        barrier = threading.Barrier(n)
        results: list[object] = []

        def approve():
            barrier.wait()
            try:
                c.service.approve_audio(c.owner, job_id)
                results.append("ok")
            except Exception as exc:
                results.append(exc)

        threads = [threading.Thread(target=approve) for _ in range(n)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=20)
            assert not t.is_alive(), "an approval never finished: lock wait or deadlock"
        assert results.count("ok") == 1
        assert all(isinstance(r, Conflict) for r in results if r != "ok")
        assert len(spawned) == 1
        job = c.job(job_id)
        assert (job["status"], job["approve_attempt"]) == (db.VIDEO_SUBMITTING, 1)
        assert without_grants(c.entries()) == sorted([voice_charge(job_id), hold(job_id)])
        assert c.wallet() == (90, PRICE)
        assert c.invariant()

    asyncio.run(run())


def test_ledger_failure_rolls_the_status_change_back(charging, monkeypatch):
    """R-10, R-56: if the ledger step fails inside a transition, the status change rolls back
    with it and the error reaches the caller."""

    async def run():
        c = charging(credits=100)
        job_id = await c.ready_job()

        def broken_hold(*args, **kwargs):
            raise RuntimeError("ledger unavailable")

        monkeypatch.setattr(ledger, "hold", broken_hold)
        with pytest.raises(RuntimeError, match="ledger unavailable"):
            c.service.approve_audio(c.owner, job_id)
        job = c.job(job_id)
        assert (job["status"], job["approve_attempt"]) == (db.AUDIO_READY, 0)
        assert c.service._tasks == set()
        assert without_grants(c.entries()) == [voice_charge(job_id)]
        assert c.invariant()

    asyncio.run(run())


@pytest.mark.parametrize(
    "row, provider_cls, poll, broken, stays",
    [
        ("voice fails", VoiceRefused, None, "voice_return", db.AUDIO_GENERATING),
        ("upload fails", FlakyUpload, None, "release", db.VIDEO_SUBMITTING),
        ("submission refused", RefusedSubmit, None, "release", db.VIDEO_SUBMITTING),
        ("submission unknown", UnknownSubmit, None, "capture", db.VIDEO_SUBMITTING),
        ("video delivered", ScriptedPolls, DONE, "capture", db.VIDEO_GENERATING),
        ("video failed", ScriptedPolls, VideoPoll("failed", error="x"), "release", None),
        ("video timeout", ScriptedPolls, VideoPoll("pending"), "release", None),
        ("restart mid-submission", MockProvider, None, "capture", db.VIDEO_SUBMITTING),
    ],
    ids=[
        "voice-fails",
        "upload-fails",
        "submission-refused",
        "submission-unknown",
        "video-delivered",
        "video-failed",
        "video-timeout",
        "restart-mid-submission",
    ],
)
def test_each_row_rolls_back_when_its_ledger_step_fails(
    charging, settings, monkeypatch, row, provider_cls, poll, broken, stays
):
    """R-10, R-56: for every §5.2 row with a wallet action, a failure of that action rolls the
    status change back too: the job keeps its previous status and no entry is written. This
    shows each row's status and ledger entry are one transaction."""
    stays = stays or db.VIDEO_GENERATING
    cfg = replace(settings, video_timeout_seconds=-1) if row == "video timeout" else settings
    provider = provider_cls(cfg, poll) if poll is not None else provider_cls(cfg)

    def fail(*args, **kwargs):
        raise RuntimeError(f"{broken} unavailable")

    monkeypatch.setattr(ledger, broken, fail)

    async def run():
        c = charging(credits=100, provider=provider, cfg=cfg)
        job = c.service.create_job(c.owner, png(), SCRIPT, "English")
        job_id = job["id"]
        await c.drain()  # background failures stay in their task; drain does not raise
        if stays != db.AUDIO_GENERATING:
            if row == "restart mid-submission":
                c.service.approve_audio(c.owner, job_id)
                for task in list(c.service._tasks):
                    task.cancel()
                await c.drain()
                with pytest.raises(RuntimeError):
                    c.service.recover_interrupted()
            else:
                c.service.approve_audio(c.owner, job_id)
                await c.drain()
                if stays == db.VIDEO_GENERATING:
                    with pytest.raises(RuntimeError):
                        await c.service.poll_once()
        before = without_grants(c.entries())
        job = c.job(job_id)
        assert (job["status"], job["needs_review"]) == (stays, False)
        assert not [e for e in before if e[0] == broken]
        assert c.invariant()

    asyncio.run(run())


# ---- jobs without an owner, and the price ---------------------------------------------------


def test_ownerless_jobs_never_touch_the_ledger(charging, settings):
    """R-10: jobs made before accounts (user_id NULL) are never charged: their voice failure,
    restart recovery and delivery write no ledger entry."""

    async def run():
        c = charging(credits=0, provider=ScriptedPolls(settings, DONE))
        ids = {name: name * 32 for name in ("a", "b", "c")}
        for job_id in ids.values():
            c.store.create(job_id, c.owner, "English", "hi", "image.png")
        with c.engine.begin() as conn:
            conn.execute(text("UPDATE jobs SET user_id = NULL"))
        # a: voice fails clearly (would return a voice charge).
        c.service.provider = VoiceRefused(settings)
        await c.service._generate_audio(ids["a"], "hi", "English")
        # c: a video delivered (would capture); moved first so the restart below skips it.
        c.store.transition(
            ids["c"],
            db.AUDIO_GENERATING,
            db.VIDEO_GENERATING,
            provider_request_id="r",
            video_started_at=db.now_iso(),
        )
        # b: a restart mid-submission (would capture).
        c.store.transition(ids["b"], db.AUDIO_GENERATING, db.VIDEO_SUBMITTING)
        c.service.recover_interrupted()
        (c.service.job_dir(ids["c"])).mkdir(parents=True)
        c.service.provider = ScriptedPolls(settings, DONE)
        await c.service.poll_once()
        assert [c.job(i)["status"] for i in ids.values()] == [db.FAILED, db.FAILED, db.COMPLETED]
        assert c.all_entries() == 0

    asyncio.run(run())


@pytest.mark.parametrize(
    "seconds, credits",
    [(1.0, 20), (2.1, 42), (0.15, 3), (2.05, 41), (2.133, 43), (29.99, 600), (30.0, 600)],
)
def test_price_is_ceil_of_seconds_times_rate(seconds, credits):
    """R-09 (D-006, D-014): ceil(seconds × 20) in whole credits, with no float error adding a
    credit (0.15 × 20 is 3.0000000000000004 as a float)."""
    price = video_price(seconds, RATE)
    assert price == credits
    assert type(price) is int


def test_stored_price_is_what_is_held_after_a_rate_change(charging, settings):
    """R-09 (D-006): the hold uses the price stored when the voice was ready, even if the rate
    setting changes before approval."""

    async def run():
        c = charging(credits=1000)
        job_id = await c.ready_job()
        c.service.settings = replace(settings, credits_per_second=50)
        c.service.approve_audio(c.owner, job_id)
        await c.drain()
        assert [e for e in c.entries() if e[0] == "hold"] == [hold(job_id, PRICE)]
        assert c.invariant()

    asyncio.run(run())


# ---- charged_credits on JobOut ---------------------------------------------------------------


def wait_for(client, job_id, status, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{job_id}").json()
        if job["status"] == status:
            return job
        time.sleep(0.05)
    raise AssertionError(f"job stayed {job['status']}, expected {status}: {job}")


@pytest.mark.parametrize(
    "provider_cls, final, charged",
    [
        (MockProvider, "completed", VOICE + PRICE),
        (RefusedSubmit, "audio_ready", VOICE),  # the video failed after the voice: voice only
        (UnknownSubmit, "failed", VOICE + PRICE),  # unknown outcome: charged (Q-19)
    ],
    ids=["completed", "failed-after-voice", "unknown-outcome"],
)
def test_job_out_reports_price_and_charged_credits(
    settings, sign_up, grant, provider_cls, final, charged
):
    """R-09, R-10: JobOut.price_credits is the stored price and charged_credits what the ledger
    took for the job; both are ints."""
    with TestClient(create_app(settings), base_url=HTTPS) as client:
        grant(client, sign_up(client), 1000)
        client.app.state.service.provider = provider_cls(settings)  # type: ignore[attr-defined]
        r = client.post(
            "/api/v1/jobs",
            files={"image": ("me.png", png(), "image/png")},
            data={"script": SCRIPT, "language": "English"},
        )
        assert r.status_code == 201, r.text
        assert (r.json()["price_credits"], r.json()["charged_credits"]) == (None, VOICE)
        job_id = r.json()["id"]
        job = wait_for(client, job_id, "audio_ready")
        assert (job["price_credits"], job["charged_credits"]) == (PRICE, VOICE)
        assert client.post(f"/api/v1/jobs/{job_id}/approve").status_code == 200
        if final == "audio_ready":
            deadline = time.monotonic() + 10
            while (job := client.get(f"/api/v1/jobs/{job_id}").json())["error"] is None:
                assert time.monotonic() < deadline, job
                time.sleep(0.05)
            assert job["status"] == final
        else:
            job = wait_for(client, job_id, final)
        assert job["price_credits"] == PRICE
        assert job["charged_credits"] == charged
        assert type(job["charged_credits"]) is int and type(job["price_credits"]) is int
