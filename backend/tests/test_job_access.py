"""T-204: every job and media route belongs to a logged-in owner (R-12, R-01, D-036).

Mock provider only; free. The unconfirmed-email rule is D-036."""

import asyncio
import time
from dataclasses import replace
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text

from app.core.config import Settings
from app.jobs import db
from app.jobs.db import JobStore
from app.jobs.service import JobNotFound, JobService
from app.main import create_app
from app.providers import MockProvider

CONFIRM_MESSAGE = (
    "Confirm your email to make videos. We sent you a link; you can ask for a new one."
)


def png() -> bytes:
    out = BytesIO()
    Image.new("RGB", (512, 512), "teal").save(out, "PNG")
    return out.getvalue()


@pytest.fixture
def settings(tmp_path, database_url):
    return replace(
        Settings(),
        provider="mock",
        data_dir=tmp_path,
        poll_interval_seconds=0.05,
        database_url=database_url,
    )


@pytest.fixture
def anon(settings):
    # start_poller=False: jobs stay where the test puts them.
    with TestClient(create_app(settings, start_poller=False), base_url="https://testserver") as c:
        yield c


@pytest.fixture
def alice(anon, make_user):
    return make_user(anon, "alice@example.com")


@pytest.fixture
def bob(anon, make_user):
    return make_user(anon, "bob@example.com")


def post_job(c):
    return c.post(
        "/api/v1/jobs",
        files={"image": ("me.png", png(), "image/png")},
        data={"script": "Hello.", "language": "English"},
    )


def engine_of(c):
    return c.app.state.service.store.engine


def assert_error(r, status, code):
    assert r.status_code == status, r.text
    assert r.json()["code"] == code
    return r.json()


def ownerless_job(c, owner_id) -> str:
    """A job as it exists from before accounts: an audio_ready row with no owner."""
    job_id = "f" * 32
    store = c.app.state.service.store
    store.create(job_id, owner_id, "English", "hi", "image.png")
    with store.engine.begin() as conn:
        conn.execute(
            text("UPDATE jobs SET user_id = NULL, status = 'audio_ready' WHERE id = :i"),
            {"i": job_id},
        )
    return job_id


def set_verified(c, email, verified):
    value = "now()" if verified else "NULL"
    with engine_of(c).begin() as conn:
        conn.execute(
            text(f"UPDATE users SET email_verified_at = {value} WHERE email = :e"), {"e": email}
        )


def test_anonymous_gets_401_on_every_job_and_media_route(anon, alice):
    """R-12: no session, no access, on create, get, approve, audio and video."""
    job_id = post_job(alice).json()["id"]
    for r in (
        post_job(anon),
        anon.get(f"/api/v1/jobs/{job_id}"),
        anon.post(f"/api/v1/jobs/{job_id}/approve"),
        anon.get(f"/api/v1/jobs/{job_id}/audio"),
        anon.get(f"/api/v1/jobs/{job_id}/video"),
    ):
        assert_error(r, 401, "not_authenticated")
    # The public routes stay public.
    assert anon.get("/api/v1/config").status_code == 200
    assert anon.get("/healthz").status_code == 200


def test_owner_can_use_every_route(alice):
    """R-12: the owner gets their own job, audio and approval."""
    job_id = post_job(alice).json()["id"]
    assert alice.get(f"/api/v1/jobs/{job_id}").status_code == 200
    assert alice.get(f"/api/v1/jobs/{job_id}/audio").status_code == 200
    assert_error(alice.get(f"/api/v1/jobs/{job_id}/video"), 404, "not_available_yet")
    assert alice.post(f"/api/v1/jobs/{job_id}/approve").status_code == 200


def test_another_users_job_is_404_on_every_route_and_is_not_changed(alice, bob):
    """R-12: user B gets the same 404 as for a missing job on get, approve, audio and video,
    and B's approve leaves A's job untouched."""
    job_id = post_job(alice).json()["id"]  # mock voice is synchronous: audio_ready
    assert alice.get(f"/api/v1/jobs/{job_id}").json()["status"] == db.AUDIO_READY
    missing = bob.get("/api/v1/jobs/nope")
    for r in (
        bob.get(f"/api/v1/jobs/{job_id}"),
        bob.post(f"/api/v1/jobs/{job_id}/approve"),
        bob.get(f"/api/v1/jobs/{job_id}/audio"),
        bob.get(f"/api/v1/jobs/{job_id}/video"),
    ):
        assert assert_error(r, 404, "job_not_found") == missing.json()
    assert alice.get(f"/api/v1/jobs/{job_id}").json()["status"] == db.AUDIO_READY
    assert alice.post(f"/api/v1/jobs/{job_id}/approve").status_code == 200


def test_ownerless_job_is_404_for_everyone_and_anonymous_is_401(anon, alice, bob):
    """R-12: a job made before accounts (no owner) is shown to nobody."""
    job_id = ownerless_job(anon, alice.user_id)
    for c in (alice, bob):
        for r in (
            c.get(f"/api/v1/jobs/{job_id}"),
            c.post(f"/api/v1/jobs/{job_id}/approve"),
            c.get(f"/api/v1/jobs/{job_id}/audio"),
            c.get(f"/api/v1/jobs/{job_id}/video"),
        ):
            assert_error(r, 404, "job_not_found")
    assert_error(anon.get(f"/api/v1/jobs/{job_id}"), 401, "not_authenticated")
    assert anon.app.state.service.store.get(job_id)["status"] == db.AUDIO_READY


def test_unconfirmed_user_gets_403_on_create_and_approve_until_confirmed(anon, make_user):
    """D-036 (R-01): 403 email_not_verified on create and approve, and the same requests pass
    after confirming. Reading stays allowed; another user's job is 404, not 403."""
    carol = make_user(anon, "carol@example.com", confirmed=False)
    dan = make_user(anon, "dan@example.com")
    dans_job = post_job(dan).json()["id"]

    body = assert_error(post_job(carol), 403, "email_not_verified")
    assert body["detail"] == CONFIRM_MESSAGE
    assert_error(carol.post(f"/api/v1/jobs/{dans_job}/approve"), 404, "job_not_found")

    # Dan loses his confirmation: he can read his job but not approve it.
    set_verified(anon, "dan@example.com", False)
    assert dan.get(f"/api/v1/jobs/{dans_job}").status_code == 200
    body = assert_error(dan.post(f"/api/v1/jobs/{dans_job}/approve"), 403, "email_not_verified")
    assert body["detail"] == CONFIRM_MESSAGE
    assert dan.get(f"/api/v1/jobs/{dans_job}").json()["status"] == db.AUDIO_READY

    set_verified(anon, "carol@example.com", True)
    set_verified(anon, "dan@example.com", True)
    assert post_job(carol).status_code == 201
    assert dan.post(f"/api/v1/jobs/{dans_job}/approve").status_code == 200


def test_unconfirmed_create_is_refused_before_the_upload_is_read(anon, make_user):
    """D-036: 403 wins over a missing image (which would otherwise be 422)."""
    carol = make_user(anon, "carol@example.com", confirmed=False)
    r = carol.post("/api/v1/jobs", data={"script": "x", "language": "English"})
    assert_error(r, 403, "email_not_verified")


def test_openapi_documents_401_and_403_on_job_routes(settings):
    """R-12: the contract shows 401 on every job route and 403 on create and approve."""
    paths = create_app(settings).openapi()["paths"]
    for path, method in (
        ("/api/v1/jobs", "post"),
        ("/api/v1/jobs/{job_id}", "get"),
        ("/api/v1/jobs/{job_id}/approve", "post"),
        ("/api/v1/jobs/{job_id}/audio", "get"),
        ("/api/v1/jobs/{job_id}/video", "get"),
    ):
        assert "401" in paths[path][method]["responses"], (method, path)
    assert "403" in paths["/api/v1/jobs"]["post"]["responses"]
    assert "403" in paths["/api/v1/jobs/{job_id}/approve"]["post"]["responses"]
    assert "401" not in paths["/api/v1/config"]["get"]["responses"]


def test_service_approve_of_another_users_job_changes_nothing(settings, database_url, seed_user):
    """R-12 (R-56): the service refuses a non-owner before the compare-and-set."""

    async def run():
        store = JobStore(database_url)
        try:
            service = JobService(settings, store, MockProvider(settings))
            a = seed_user(database_url, "a@example.com")
            b = seed_user(database_url, "b@example.com")
            job_id = service.create_job(a, png(), "Hello there.", "English")["id"]
            while service._tasks:
                await asyncio.gather(*list(service._tasks))
            with pytest.raises(JobNotFound):
                service.approve_audio(b, job_id)
            assert store.get(job_id)["status"] == db.AUDIO_READY
            assert service.provider.submit_count == 0
        finally:
            store.close()

    asyncio.run(run())


def test_poller_still_finishes_a_job_after_ownership(settings, sign_up):
    """R-12: the poller (which reads jobs without an owner filter) completes an owned job."""
    with TestClient(create_app(settings), base_url="https://testserver") as c:
        sign_up(c)
        job_id = post_job(c).json()["id"]
        deadline = time.monotonic() + 10
        while c.get(f"/api/v1/jobs/{job_id}").json()["status"] != "audio_ready":
            assert time.monotonic() < deadline
            time.sleep(0.05)
        assert c.post(f"/api/v1/jobs/{job_id}/approve").status_code == 200
        while (job := c.get(f"/api/v1/jobs/{job_id}").json())["status"] != "completed":
            assert time.monotonic() < deadline, job
            time.sleep(0.05)
        assert c.get(job["video_url"]).status_code == 200
