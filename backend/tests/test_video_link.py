"""T-553: play the finished video from the fal.ai link instead of storing it (D-065; R-24, R-74).

fal.ai is never reached: the fal client runs over an `httpx.MockTransport` that records every
request, and the provider's download helper raises if anything tries to fetch a video. Free."""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import fal_client
import fal_client.client
import httpx
import pytest
from sqlalchemy import text

from app.jobs import db
from app.providers import FalProvider, MockProvider, VideoPoll
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

FAL_VIDEO = "https://v3.fal.media/files/example/output.mp4"
EXPIRED_MESSAGE = "This video has expired. Videos are kept for 30 days."


# ---- the fal provider, over a fake transport ------------------------------------------------


class FakeFal:
    """Answers fal's queue API: submit, status (COMPLETED) and result. Records every request."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.method == "POST":
            return httpx.Response(
                200,
                json={
                    "request_id": "req-1",
                    "response_url": "https://queue.fal.run/x/requests/req-1",
                    "status_url": "https://queue.fal.run/x/requests/req-1/status",
                    "cancel_url": "https://queue.fal.run/x/requests/req-1/cancel",
                },
            )
        if request.url.path.endswith("/status"):
            return httpx.Response(200, json={"status": "COMPLETED", "logs": []})
        return httpx.Response(200, json={"video": {"url": FAL_VIDEO}, "duration": 2.1})


@pytest.fixture
def fal(settings, monkeypatch):  # noqa: F811
    """A FalProvider whose fal client sends every request to a FakeFal, and that cannot
    download anything."""
    fake = FakeFal()
    # AsyncClient._client builds its transport from this name at first use.
    monkeypatch.setattr(
        fal_client.client, "AsyncBackupDomainTransport", lambda: httpx.MockTransport(fake)
    )
    client = fal_client.AsyncClient(key="test-key")
    provider = FalProvider(settings)
    provider._fal = SimpleNamespace(
        submit_async=client.submit, status_async=client.status, result_async=client.result
    )

    async def no_download(url: str) -> bytes:
        raise AssertionError(f"tried to download {url}")

    monkeypatch.setattr(provider, "_download", no_download)
    return provider, fake


def test_d065_fal_submit_sends_the_30_day_lifecycle_header(fal):
    """R-24, D-065: the queue submission carries X-Fal-Object-Lifecycle-Preference with 30
    days, and the request id comes back as before."""
    provider, fake = fal
    request_id = asyncio.run(provider.submit_video("https://img", "https://aud"))
    assert request_id == "req-1"
    [submit] = fake.requests
    assert submit.method == "POST" and submit.url.host == "queue.fal.run"
    header = submit.headers["X-Fal-Object-Lifecycle-Preference"]
    assert json.loads(header) == {"expiration_duration_seconds": 2592000}
    assert json.loads(submit.content) == {"image_url": "https://img", "audio_url": "https://aud"}


def test_d065_fal_poll_returns_the_link_without_downloading(fal):
    """R-24, D-065: a finished video comes back as fal's URL; nothing fetches the video."""
    provider, fake = fal
    poll = asyncio.run(provider.poll_video("req-1"))
    assert poll == VideoPoll("done", url=FAL_VIDEO)
    assert poll.data is None
    assert all(r.url.host == "queue.fal.run" for r in fake.requests)
    assert FAL_VIDEO not in {str(r.url) for r in fake.requests}


# ---- completion stores the link, captures once ----------------------------------------------


def test_r74_completed_with_a_link_stores_url_and_expiry_and_captures_once(charging, settings):  # noqa: F811
    """R-24, R-74, R-10, D-065: done with a URL → completed, video_url and video_expires_at
    (now + 30 days) stored, no file written, exactly one capture even when polled again and
    concurrently."""

    async def run():
        done = VideoPoll("done", url=FAL_VIDEO)
        c = charging(credits=100, provider=ScriptedPolls(settings, done))
        job_id = await c.approved_job()
        before = datetime.now(timezone.utc).replace(microsecond=0)
        await asyncio.gather(c.service.poll_once(), c.service.poll_once())
        await c.service.poll_once()
        job = c.job(job_id)
        assert job["status"] == db.COMPLETED
        assert job["video_url"] == FAL_VIDEO
        assert job["video_file"] is None
        assert not (c.service.job_dir(job_id) / "video.mp4").exists()
        expires = datetime.fromisoformat(job["video_expires_at"])
        assert before + timedelta(days=30) <= expires <= before + timedelta(days=30, minutes=1)
        assert without_grants(c.entries()) == sorted(
            [voice_charge(job_id), hold(job_id), capture(job_id)]
        )
        assert c.invariant()

    asyncio.run(run())


def test_d065_mock_path_still_writes_the_file_and_no_link(charging, settings):  # noqa: F811
    """R-24, D-065: the mock provider returns bytes; the job keeps a local file as before."""

    async def run():
        c = charging(credits=100, provider=MockProvider(settings))
        job_id = await c.approved_job()
        for _ in range(MockProvider.polls_before_done):
            await c.service.poll_once()
        job = c.job(job_id)
        assert job["status"] == db.COMPLETED
        assert job["video_file"] == "video.mp4" and job["video_url"] is None
        assert job["video_expires_at"] is None
        assert (c.service.job_dir(job_id) / "video.mp4").stat().st_size > 0

    asyncio.run(run())


# ---- GET /jobs/{id}/video -------------------------------------------------------------------


def linked_job(c, expires_at: datetime) -> str:
    """A completed job of `c`'s user whose video is only fal's link."""
    job_id = post_job(c).json()["id"]
    with engine_of(c).begin() as conn:
        conn.execute(
            text(
                "UPDATE jobs SET status = 'completed', video_file = NULL, video_url = :u, "
                "video_expires_at = :e WHERE id = :i"
            ),
            {"u": FAL_VIDEO, "e": expires_at, "i": job_id},
        )
    return job_id


def test_d065_owner_is_redirected_to_the_stored_link(alice):  # noqa: F811
    """R-24, R-74, D-065: the owner's GET /video is a 302 to the stored fal URL; the job shows
    our route, not fal's, and video_expired is false."""
    job_id = linked_job(alice, datetime.now(timezone.utc) + timedelta(days=29))
    r = alice.get(f"/api/v1/jobs/{job_id}/video", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == FAL_VIDEO
    job = alice.get(f"/api/v1/jobs/{job_id}").json()
    assert job["video_url"] == f"/api/v1/jobs/{job_id}/video"
    assert job["video_expired"] is False
    [item] = alice.get("/api/v1/jobs").json()["items"]
    assert item["video_expired"] is False


def test_d065_another_user_gets_404_not_the_link(alice, bob):  # noqa: F811
    """R-12, D-065: another user's job is 404 and never reveals the fal URL."""
    job_id = linked_job(alice, datetime.now(timezone.utc) + timedelta(days=29))
    r = bob.get(f"/api/v1/jobs/{job_id}/video", follow_redirects=False)
    assert_error(r, 404, "job_not_found")
    assert FAL_VIDEO not in r.text and "location" not in r.headers


def test_d065_expired_link_is_410_and_flagged(alice):  # noqa: F811
    """R-24, D-065: after the 30 days the route answers 410 video_expired with the customer
    message, and the job and the list say video_expired."""
    job_id = linked_job(alice, datetime.now(timezone.utc) - timedelta(seconds=1))
    r = alice.get(f"/api/v1/jobs/{job_id}/video", follow_redirects=False)
    body = assert_error(r, 410, "video_expired")
    assert body["detail"] == EXPIRED_MESSAGE
    assert FAL_VIDEO not in r.text
    job = alice.get(f"/api/v1/jobs/{job_id}").json()
    assert job["video_expired"] is True
    assert job["video_url"] == f"/api/v1/jobs/{job_id}/video"
    [item] = alice.get("/api/v1/jobs").json()["items"]
    assert item["video_expired"] is True
