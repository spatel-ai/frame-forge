# ruff: noqa: F811  (pytest fixtures imported from other test modules are used by name)
"""D-066, D-019: the `video_assembling` step (banners, and the S3 copy of finished videos, owner
2026-11-17). Requirements: R-44 (banners), R-53 (banner joining is free and retried), R-10 (one
capture per approval), R-12 (ownership), R-13 (one video-ready email), R-24 (the video plays from
our route).

Free: the mock provider, small generated clips, a fake in-memory storage and a stubbed boto3
client. Nothing reaches fal.ai or AWS. ffmpeg tests skip cleanly without ffmpeg."""

import asyncio
import shutil
import threading
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import text

from app.core.config import Settings
from app.jobs import db
from app.jobs import service as service_module
from app.jobs.db import JobStore
from app.jobs.service import JobService
from app.media import MediaError, measure
from app.media import storage as storage_module
from app.media.storage import S3VideoStorage, build_video_storage
from app.providers import VideoPoll
from tests.test_charging import (  # noqa: F401  (pytest fixtures used by name)
    ScriptedPolls,
    capture,
    charging,
    hold,
    voice_charge,
    without_grants,
)
from tests.test_job_access import (  # noqa: F401  (pytest fixtures used by name)
    alice,
    anon,
    assert_error,
    bob,
    engine_of,
    post_job,
    settings,
)
from tests.test_media import make_clip
from tests.test_video_ready_email import Recorder, wait

needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are needed to add banners",
)

FAL_VIDEO = "https://v3.fal.media/files/example/output.mp4"
AI_S, BANNER_S = 2.0, 1.0


# ---- fixtures ----------------------------------------------------------------------------


@pytest.fixture(scope="module")
def media(tmp_path_factory):
    """Small banners (the real ones are 720x1280 and slower to encode) and a 2 s AI clip."""
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        pytest.skip("ffmpeg and ffprobe are needed to add banners")
    d = tmp_path_factory.mktemp("banners")
    make_clip(d / "start.mp4", size="320x180", fps="25", duration=BANNER_S, colour="red")
    make_clip(d / "end.mp4", size="320x180", fps="25", duration=BANNER_S, colour="lime")
    Image.new("RGBA", (64, 64), (255, 255, 0, 255)).save(d / "overlay.png")
    ai = make_clip(d / "ai.mp4", size="320x180", fps="25", duration=AI_S, colour="blue")
    return {"dir": d, "ai": ai}


@pytest.fixture
def banners_on(settings, media):  # noqa: F811
    """This file's tests opt in to banners (conftest turns them off for every other test)."""
    return replace(settings, banners_enabled=True, banner_dir=media["dir"])


class FakeStorage:
    """In-memory stand-in for S3: copies the bytes; `fail` makes the next N puts raise."""

    def __init__(self, fail: int = 0):
        self.objects: dict[str, bytes] = {}
        self.fail = fail

    def put(self, local_path, key):
        if self.fail:
            self.fail -= 1
            raise OSError("S3 is down")
        self.objects[key] = Path(local_path).read_bytes()

    def url(self, key, filename=None):
        return f"https://bucket.s3.example/{key}?filename={filename}"

    def delete(self, key):
        self.objects.pop(key, None)


def setup(charging, cfg, media, poll: VideoPoll | None = None, storage=None):  # noqa: F811
    """A Charging whose provider answers `poll` (default: the AI clip's bytes), an email
    recorder, and (optionally) fake storage."""
    poll = poll or VideoPoll("done", data=media["ai"].read_bytes())
    c = charging(credits=1000, provider=ScriptedPolls(cfg, poll), cfg=cfg)
    c.rec = Recorder()
    c.service.email_sender = c.rec
    c.service.storage = storage
    return c


def captures(c, job_id: str) -> int:
    return sum(1 for e in c.entries() if e[0] == "capture" and e[1].startswith(job_id))


def money_ok(c, job_id: str) -> None:
    """R-10: voice charge, one hold, exactly one capture; the balance matches the ledger."""
    assert without_grants(c.entries()) == sorted(
        [voice_charge(job_id), hold(job_id), capture(job_id)]
    )
    assert c.invariant()


def emails(c) -> int:
    wait(c.rec)
    return len(c.rec.sent)


def failing_compose(monkeypatch, times: int):
    """Make `compose` fail its first `times` calls (then run for real). Returns the call list."""
    calls: list[int] = []
    real = service_module.compose

    def fake(*args, **kwargs):
        calls.append(1)
        if len(calls) <= times:
            raise MediaError("The banners could not be added to the video.", "test failure")
        return real(*args, **kwargs)

    monkeypatch.setattr(service_module, "compose", fake)
    return calls


def leftovers(c, job_id: str) -> list[str]:
    """Temporary files of the assembling step left in the job's folder."""
    return sorted(p.name for p in c.service.job_dir(job_id).iterdir() if p.name.startswith("."))


# ---- local disk (mock mode, no bucket) ---------------------------------------------------


@needs_ffmpeg
def test_d066_r44_success_assembles_then_completes_with_one_capture(charging, banners_on, media):  # noqa: F811
    """R-44, R-10, R-13, D-066: done → video_assembling (no ledger step, the hold stays) →
    completed with ONE capture, banners_applied true, a joined video that differs from the AI
    file (which is kept, joining rule 7), and one email."""

    async def run():
        c = setup(charging, banners_on, media)
        job_id = await c.approved_job()
        seen: list[str] = []
        real = c.store.transition

        def spy(job, frm, to, ledger=None, **kw):
            moved = real(job, frm, to, ledger=ledger, **kw)
            if moved and frm == db.VIDEO_GENERATING:
                seen.append(to)
                assert ledger is None  # money rule 10: no wallet step on the way in
                assert c.wallet()[1] > 0  # the hold is still there
            return moved

        c.store.transition = spy
        await c.service.poll_once()
        await c.service.poll_once()  # already completed: nothing more
        job = c.job(job_id)
        assert seen == [db.VIDEO_ASSEMBLING]
        assert job["status"] == db.COMPLETED and job["banners_applied"] is True
        assert job["video_file"] == "video.mp4" and job["ai_video_file"] == "ai_video.mp4"
        folder = c.service.job_dir(job_id)
        assert (folder / "ai_video.mp4").read_bytes() == media["ai"].read_bytes()
        assert (folder / "video.mp4").read_bytes() != (folder / "ai_video.mp4").read_bytes()
        assert measure(folder / "video.mp4").duration > AI_S + 1.0
        assert job["needs_review"] is False and job["assembly_attempts"] == 0
        money_ok(c, job_id)
        assert emails(c) == 1 and leftovers(c, job_id) == []

    asyncio.run(run())


@needs_ffmpeg
def test_d019_r53_failure_then_success_on_the_next_cycle(
    charging,
    banners_on,
    media,
    monkeypatch,  # noqa: F811
):
    """R-53, D-019: a failed join counts one attempt and waits in video_assembling (no capture,
    no email); the next poller cycle succeeds with one capture and one email."""

    async def run():
        failing_compose(monkeypatch, times=1)
        c = setup(charging, banners_on, media)
        job_id = await c.approved_job()
        await c.service.poll_once()
        job = c.job(job_id)
        assert job["status"] == db.VIDEO_ASSEMBLING and job["assembly_attempts"] == 1
        wait(c.rec, True)
        assert captures(c, job_id) == 0 and c.rec.sent == []
        await c.service.poll_once()
        job = c.job(job_id)
        assert job["status"] == db.COMPLETED and job["banners_applied"] is True
        assert job["needs_review"] is False
        money_ok(c, job_id)
        assert emails(c) == 1

    asyncio.run(run())


@needs_ffmpeg
def test_d019_fallback_after_three_failures_delivers_the_ai_video(
    charging,
    banners_on,
    media,
    monkeypatch,  # noqa: F811
):
    """D-019 (Q-17), R-10, R-13: after assembly_max_attempts (3) failed joins the paid AI video
    is delivered as it is: completed, one capture, banners_applied false, needs_review true,
    the video is the AI file; one email."""

    async def run():
        calls = failing_compose(monkeypatch, times=99)
        c = setup(charging, banners_on, media)
        job_id = await c.approved_job()
        for attempt in (1, 2):
            await c.service.poll_once()
            job = c.job(job_id)
            assert job["status"] == db.VIDEO_ASSEMBLING and job["assembly_attempts"] == attempt
            assert captures(c, job_id) == 0
        await c.service.poll_once()
        await c.service.poll_once()  # nothing more happens
        job = c.job(job_id)
        assert len(calls) == 3
        assert job["status"] == db.COMPLETED and job["assembly_attempts"] == 3
        assert job["banners_applied"] is False and job["needs_review"] is True
        assert job["video_file"] == "ai_video.mp4"
        assert job["error"] is None
        money_ok(c, job_id)
        assert emails(c) == 1 and leftovers(c, job_id) == []

    asyncio.run(run())


@needs_ffmpeg
def test_d019_restart_a_job_left_assembling_is_finished_by_the_next_poll(
    charging,
    banners_on,
    media,
    monkeypatch,  # noqa: F811
):
    """D-019, R-53, R-10: a job left in video_assembling by a restart is not failed by
    recover_interrupted (the step is free) and the next poll of a NEW service finishes it, with
    one capture and one email."""

    async def run():
        failing_compose(monkeypatch, times=1)
        c = setup(charging, banners_on, media)
        job_id = await c.approved_job()
        await c.service.poll_once()
        assert c.job(job_id)["status"] == db.VIDEO_ASSEMBLING
        # "Restart": a new store and service over the same database, nothing in memory.
        store = JobStore(banners_on.database_url)
        try:
            rec = Recorder()
            fresh = JobService(banners_on, store, ScriptedPolls(banners_on, VideoPoll("pending")))
            fresh.email_sender = rec
            fresh.recover_interrupted()
            assert c.job(job_id)["status"] == db.VIDEO_ASSEMBLING
            await fresh.poll_once()
            wait(rec)
            assert c.job(job_id)["status"] == db.COMPLETED
            assert c.job(job_id)["banners_applied"] is True
            money_ok(c, job_id)
            assert len(rec.sent) == 1 and c.rec.sent == []
        finally:
            store.close()

    asyncio.run(run())


@needs_ffmpeg
def test_r10_two_concurrent_polls_and_two_services_capture_once(
    charging,
    banners_on,
    media,
    monkeypatch,  # noqa: F811
):
    """R-10, money rule 4: two polls at once on one service, and two services (two processes)
    over the same database, finish the job once: one capture, one email."""

    async def run():
        failing_compose(monkeypatch, times=1)
        c = setup(charging, banners_on, media)
        job_id = await c.approved_job()
        await asyncio.gather(c.service.poll_once(), c.service.poll_once())
        assert c.job(job_id)["status"] == db.VIDEO_ASSEMBLING
        store = JobStore(banners_on.database_url)
        try:
            other = JobService(banners_on, store, ScriptedPolls(banners_on, VideoPoll("pending")))
            other.email_sender = c.rec
            await asyncio.gather(c.service.poll_once(), c.service.poll_once(), other.poll_once())
        finally:
            store.close()
        assert c.job(job_id)["status"] == db.COMPLETED
        money_ok(c, job_id)
        assert emails(c) == 1

    asyncio.run(run())


@needs_ffmpeg
def test_one_assembly_at_a_time_two_jobs_both_complete(
    charging,
    banners_on,
    media,
    monkeypatch,  # noqa: F811
):
    """R-53 (2 GB server): two jobs ready at once are joined one after the other, never at the
    same time, and both complete with one capture each."""

    async def run():
        failing_compose(monkeypatch, times=2)  # both wait in video_assembling first
        active, peak, lock = [0], [0], threading.Lock()
        real = service_module.compose

        def slow(*args, **kwargs):
            with lock:
                active[0] += 1
                peak[0] = max(peak[0], active[0])
            try:
                time.sleep(0.3)
                return real(*args, **kwargs)
            finally:
                with lock:
                    active[0] -= 1

        c = setup(charging, banners_on, media)
        first = await c.approved_job()
        second = await c.approved_job()
        await c.service.poll_once()
        assert {c.job(j)["status"] for j in (first, second)} == {db.VIDEO_ASSEMBLING}
        monkeypatch.setattr(service_module, "compose", slow)
        await asyncio.gather(c.service._assemble(first), c.service._assemble(second))
        assert peak[0] == 1
        for job_id in (first, second):
            assert c.job(job_id)["status"] == db.COMPLETED
            assert captures(c, job_id) == 1
        assert c.invariant()

    asyncio.run(run())


def test_d066_banners_off_is_todays_flow_exactly(charging, settings):  # noqa: F811
    """D-066: with banners off and no bucket the job goes video_generating → completed with the
    provider's bytes as video.mp4; no assembling, banners_applied NULL; one capture, one email."""

    async def run():
        assert settings.banners_enabled is False
        c = charging(credits=100, provider=ScriptedPolls(settings, VideoPoll("done", data=b"v")))
        c.rec = Recorder()
        c.service.email_sender = c.rec
        assert c.service.storage is None
        job_id = await c.approved_job()
        await c.service.poll_once()
        job = c.job(job_id)
        assert job["status"] == db.COMPLETED and job["video_file"] == "video.mp4"
        assert (c.service.job_dir(job_id) / "video.mp4").read_bytes() == b"v"
        assert job["banners_applied"] is None and job["ai_video_file"] is None
        assert job["video_key"] is None and job["assembly_attempts"] == 0
        assert captures(c, job_id) == 1 and emails(c) == 1

    asyncio.run(run())


# ---- S3 storage (fake) -------------------------------------------------------------------


@pytest.fixture
def fake_download(monkeypatch, media):
    """The fal link 'downloads' the AI clip; no network."""
    fetched: list[str] = []

    async def download(url, path):
        fetched.append(url)
        Path(path).write_bytes(media["ai"].read_bytes())

    monkeypatch.setattr(service_module, "download_video", download)
    return fetched


@needs_ffmpeg
def test_s3_fal_link_stores_both_keys_and_cleans_up(charging, banners_on, media, fake_download):  # noqa: F811
    """R-44, R-24, R-10 (S3, owner 2026-11-17): fal link → downloaded → AI copy stored as
    <prefix>/<id>/ai.mp4 → joined → stored as <prefix>/<id>/video.mp4 → completed with one
    capture; video_url NULL, expiry now + 30 days; no temporary file left."""

    async def run():
        s3 = FakeStorage()
        c = setup(charging, banners_on, media, VideoPoll("done", url=FAL_VIDEO), s3)
        job_id = await c.approved_job()
        before = datetime.now(timezone.utc).replace(microsecond=0)
        await c.service.poll_once()
        job = c.job(job_id)
        ai_key, video_key = f"videos/{job_id}/ai.mp4", f"videos/{job_id}/video.mp4"
        assert job["status"] == db.COMPLETED and job["banners_applied"] is True
        assert (job["ai_video_key"], job["video_key"]) == (ai_key, video_key)
        assert job["video_url"] is None and job["video_file"] is None
        assert job["ai_video_url"] == FAL_VIDEO and fake_download == [FAL_VIDEO]
        assert s3.objects[ai_key] == media["ai"].read_bytes()
        assert s3.objects[video_key] != s3.objects[ai_key]
        expires = datetime.fromisoformat(job["video_expires_at"])
        assert before + timedelta(days=30) <= expires <= before + timedelta(days=30, minutes=1)
        assert leftovers(c, job_id) == []
        assert not (c.service.job_dir(job_id) / "video.mp4").exists()
        money_ok(c, job_id)
        assert emails(c) == 1

    asyncio.run(run())


@needs_ffmpeg
def test_s3_failing_retries_then_falls_back_to_the_fal_link(
    charging,
    banners_on,
    media,
    fake_download,  # noqa: F811
):
    """D-019, D-065, R-10: S3 failing counts as a failed try; after 3 the paid video is
    delivered from fal's link (video_url, its 30-day expiry), flagged; one capture; temporary
    files removed."""

    async def run():
        s3 = FakeStorage(fail=99)
        c = setup(charging, banners_on, media, VideoPoll("done", url=FAL_VIDEO), s3)
        job_id = await c.approved_job()
        for _ in range(4):
            await c.service.poll_once()
        job = c.job(job_id)
        assert job["status"] == db.COMPLETED and job["assembly_attempts"] == 3
        assert job["video_url"] == FAL_VIDEO and job["video_key"] is None
        assert job["video_expires_at"] is not None
        assert job["needs_review"] is True and job["banners_applied"] is False
        assert s3.objects == {} and leftovers(c, job_id) == []
        money_ok(c, job_id)
        assert emails(c) == 1

    asyncio.run(run())


@needs_ffmpeg
def test_s3_join_failing_falls_back_to_the_stored_ai_copy(
    charging,
    banners_on,
    media,
    fake_download,
    monkeypatch,  # noqa: F811
):
    """D-019: with S3 working but joining failing 3 times, the video is the stored AI copy
    (video_key = the AI key), banners_applied false, flagged; the AI copy is uploaded once."""

    async def run():
        failing_compose(monkeypatch, times=99)
        s3 = FakeStorage()
        puts: list[str] = []
        real_put = s3.put
        s3.put = lambda path, key: (puts.append(key), real_put(path, key))
        c = setup(charging, banners_on, media, VideoPoll("done", url=FAL_VIDEO), s3)
        job_id = await c.approved_job()
        for _ in range(3):
            await c.service.poll_once()
        job = c.job(job_id)
        assert job["status"] == db.COMPLETED
        assert job["video_key"] == job["ai_video_key"] == f"videos/{job_id}/ai.mp4"
        assert puts == [f"videos/{job_id}/ai.mp4"]
        assert job["video_url"] is None
        assert job["needs_review"] is True and job["banners_applied"] is False
        assert leftovers(c, job_id) == []
        money_ok(c, job_id)

    asyncio.run(run())


def test_s3_with_banners_off_still_stores_the_ai_video(charging, settings, monkeypatch):  # noqa: F811
    """S3 (owner 2026-11-17), D-066: banners off but a bucket configured: the AI video is copied
    to S3 through the same step and delivered from there; nothing is joined."""

    async def run():
        async def download(url, path):
            Path(path).write_bytes(b"ai-bytes")

        monkeypatch.setattr(service_module, "download_video", download)
        monkeypatch.setattr(service_module, "compose", lambda *a, **k: pytest.fail("joined"))
        s3 = FakeStorage()
        c = charging(
            credits=100, provider=ScriptedPolls(settings, VideoPoll("done", url=FAL_VIDEO))
        )
        c.service.storage = s3
        job_id = await c.approved_job()
        await c.service.poll_once()
        job = c.job(job_id)
        assert job["status"] == db.COMPLETED
        assert job["video_key"] == job["ai_video_key"] == f"videos/{job_id}/ai.mp4"
        assert s3.objects == {f"videos/{job_id}/ai.mp4": b"ai-bytes"}
        assert job["banners_applied"] is None and job["needs_review"] is False
        assert captures(c, job_id) == 1 and leftovers(c, job_id) == []

    asyncio.run(run())


# ---- GET /jobs/{id}/video with a stored video ----------------------------------------------


def stored_job(c, expires_at: datetime) -> str:
    job_id = post_job(c).json()["id"]
    with engine_of(c).begin() as conn:
        conn.execute(
            text(
                "UPDATE jobs SET status = 'completed', video_key = :k, video_expires_at = :e, "
                "banners_applied = true WHERE id = :i"
            ),
            {"k": f"videos/{job_id}/video.mp4", "e": expires_at, "i": job_id},
        )
    return job_id


def test_s3_owner_is_redirected_to_a_signed_link(alice):  # noqa: F811
    """R-24, R-12 (S3): the owner gets a 302 to the storage link for the video key, named
    frameforge-video-<id>.mp4; JSON shows only our route and banners_applied."""
    alice.app.state.service.storage = FakeStorage()
    job_id = stored_job(alice, datetime.now(timezone.utc) + timedelta(days=29))
    r = alice.get(f"/api/v1/jobs/{job_id}/video", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == (
        f"https://bucket.s3.example/videos/{job_id}/video.mp4"
        f"?filename=frameforge-video-{job_id}.mp4"
    )
    job = alice.get(f"/api/v1/jobs/{job_id}").json()
    assert job["video_url"] == f"/api/v1/jobs/{job_id}/video"
    assert job["banners_applied"] is True and job["video_expired"] is False
    assert "s3.example" not in alice.get(f"/api/v1/jobs/{job_id}").text


def test_s3_another_user_gets_404(alice, bob):  # noqa: F811
    """R-12: another user's stored video is 404 and never reveals the link."""
    alice.app.state.service.storage = FakeStorage()
    job_id = stored_job(alice, datetime.now(timezone.utc) + timedelta(days=29))
    r = bob.get(f"/api/v1/jobs/{job_id}/video", follow_redirects=False)
    assert_error(r, 404, "job_not_found")
    assert "location" not in r.headers


def test_s3_expired_is_410(alice):  # noqa: F811
    """R-24: after 30 days a stored video answers 410 video_expired; the job says expired."""
    alice.app.state.service.storage = FakeStorage()
    job_id = stored_job(alice, datetime.now(timezone.utc) - timedelta(seconds=1))
    r = alice.get(f"/api/v1/jobs/{job_id}/video", follow_redirects=False)
    assert_error(r, 410, "video_expired")
    assert alice.get(f"/api/v1/jobs/{job_id}").json()["video_expired"] is True


# ---- S3VideoStorage and settings -----------------------------------------------------------


class FakeS3Client:
    def __init__(self):
        self.calls: list[tuple] = []

    def upload_file(self, filename, bucket, key, ExtraArgs=None):  # noqa: N803  (boto3 names)
        self.calls.append(("upload_file", filename, bucket, key, ExtraArgs))

    def delete_object(self, Bucket, Key):  # noqa: N803
        self.calls.append(("delete_object", Bucket, Key))


def test_s3_storage_upload_and_delete_arguments(tmp_path):
    """S3 (owner 2026-11-17): put uploads to the bucket and key with ContentType video/mp4;
    delete removes that key. Stubbed client: nothing reaches AWS."""
    client = FakeS3Client()
    s3 = S3VideoStorage("frameforge-videos", "ap-south-1", 3600, client=client)
    (tmp_path / "v.mp4").write_bytes(b"x")
    s3.put(tmp_path / "v.mp4", "videos/j1/video.mp4")
    s3.delete("videos/j1/video.mp4")
    assert client.calls == [
        (
            "upload_file",
            str(tmp_path / "v.mp4"),
            "frameforge-videos",
            "videos/j1/video.mp4",
            {"ContentType": "video/mp4"},
        ),
        ("delete_object", "frameforge-videos", "videos/j1/video.mp4"),
    ]


def test_s3_presigned_link_is_signed_locally_with_expiry_and_filename(monkeypatch):
    """S3: the link is a SigV4 presigned GET for the bucket and key, valid s3_url_seconds, with a
    download filename. Real boto3 with dummy keys: presigning is local, no network call."""
    # Dummy keys through boto3's normal chain (the environment), as on a server outside EC2.
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIATESTTESTTEST")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "not-a-real-secret")
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    s3 = S3VideoStorage("frameforge-videos", "ap-south-1", 3600)
    link = s3.url("videos/j1/video.mp4", filename="frameforge-video-j1.mp4")
    assert link.startswith(
        "https://frameforge-videos.s3.ap-south-1.amazonaws.com/videos/j1/video.mp4?"
    )
    assert "X-Amz-Algorithm=AWS4-HMAC-SHA256" in link and "X-Amz-Expires=3600" in link
    assert "response-content-disposition=attachment" in link
    assert "frameforge-video-j1.mp4" in link
    assert "not-a-real-secret" not in link


def test_settings_defaults_and_storage_choice(monkeypatch, tmp_path):
    """D-066, S3: the app default has banners ON (tests turn them off in conftest), the banner
    files are committed, no bucket means local disk, a bucket means S3, and production with fal
    refuses to start without a bucket."""
    monkeypatch.delenv("AVATAR_BANNERS", raising=False)
    s = Settings()
    assert s.banners_enabled is True
    assert {p.name for p in s.banner_dir.iterdir()} >= {"start.mp4", "end.mp4", "overlay.png"}
    assert (s.banner_pad_color, s.assembly_max_attempts, s.assembly_concurrency) == (
        "0x15215e",
        3,
        1,
    )
    assert (s.s3_bucket, s.s3_prefix, s.s3_url_seconds) == ("", "videos", 3600)
    assert build_video_storage(s) is None
    made: list[tuple] = []
    monkeypatch.setattr(storage_module, "S3VideoStorage", lambda *a, **k: made.append(a) or "s3")
    assert build_video_storage(replace(s, s3_bucket="b")) == "s3"
    assert made == [("b", s.s3_region, 3600)]
    with pytest.raises(ValueError, match="AVATAR_S3_BUCKET"):
        replace(s, environment="production", provider="fal", payments="razorpay",
                razorpay_key_id="rzp_live_x", razorpay_key_secret="y")  # fmt: skip
