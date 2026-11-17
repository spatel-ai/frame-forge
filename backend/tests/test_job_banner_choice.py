"""The customer's own banner on each video (D-067): a banner must be chosen at approval, the job
keeps its own copy of the image, and the final video opens and closes with clips made from it.
R-12, R-44, R-85. Mock only: no network, no paid call."""

import asyncio
import shutil
from dataclasses import replace
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text

from app.jobs import db
from app.jobs.service import BANNER_COPY
from app.main import create_app
from app.media import measure
from app.providers import VideoPoll
from tests.conftest import CONSENT_FORM
from tests.test_banners import banners_on, media, setup  # noqa: F401  (fixtures by name)
from tests.test_charging import charging  # noqa: F401
from tests.test_job_access import settings  # noqa: F401

HTTPS = "https://testserver"


def logo_png() -> bytes:
    out = BytesIO()
    Image.new("RGBA", (300, 300), (200, 30, 30, 255)).save(out, "PNG")
    return out.getvalue()


def photo_png() -> bytes:
    out = BytesIO()
    Image.new("RGB", (512, 512), "teal").save(out, "PNG")
    return out.getvalue()


@pytest.fixture
def app_on(settings):  # noqa: F811
    cfg = replace(settings, banners_enabled=True)
    with TestClient(create_app(cfg, start_poller=False), base_url=HTTPS) as anon:
        yield anon


def ready_job(c) -> str:
    """A job waiting for approval (the voice is made by the mock in the app's own loop)."""
    r = c.post(
        "/api/v1/jobs",
        files={"image": ("me.png", photo_png(), "image/png")},
        data={**CONSENT_FORM, "script": "Hello there.", "language": "English"},
    )
    assert r.status_code == 201, r.text
    job_id = r.json()["id"]
    for _ in range(200):
        if c.get(f"/api/v1/jobs/{job_id}").json()["status"] == "audio_ready":
            return job_id
        c.portal.call(asyncio.sleep, 0.02)
    raise AssertionError("the voice was not ready")


def upload_banner(c, name: str = "My logo") -> str:
    r = c.post(
        "/api/v1/banners", data={"name": name}, files={"image": ("l.png", logo_png(), "image/png")}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_a_video_cannot_be_approved_without_a_banner(app_on, make_user, grant):
    """D-067, R-85: with banners on, approval without a banner is 422 on `banner_id`; nothing is
    held and the job still waits for approval."""
    alice = make_user(app_on, "alice@example.com")
    grant(app_on, alice.user_id, 1_000)
    job_id = ready_job(alice)
    for body in (None, {}, {"banner_id": None}, {"banner_id": ""}):
        r = alice.post(f"/api/v1/jobs/{job_id}/approve", json=body)
        assert r.status_code == 422 and "banner_id" in r.json()["fields"], r.text
    assert alice.get(f"/api/v1/jobs/{job_id}").json()["status"] == "audio_ready"
    assert alice.get("/api/v1/wallet").json()["reserved_credits"] == 0


def test_another_users_or_deleted_banner_is_404_and_nothing_is_held(app_on, make_user, grant):
    """D-067, R-12: only the caller's own live banner can be chosen."""
    alice = make_user(app_on, "alice@example.com")
    bob = make_user(app_on, "bob@example.com")
    grant(app_on, alice.user_id, 1_000)
    bobs = upload_banner(bob)
    gone = upload_banner(alice)
    assert alice.delete(f"/api/v1/banners/{gone}").status_code == 204
    job_id = ready_job(alice)
    for banner_id in (bobs, gone, "nope"):
        r = alice.post(f"/api/v1/jobs/{job_id}/approve", json={"banner_id": banner_id})
        assert r.status_code == 404 and r.json()["code"] == "banner_not_found", r.text
    assert alice.get("/api/v1/wallet").json()["reserved_credits"] == 0


def test_approving_with_a_banner_stores_it_and_keeps_a_copy(app_on, make_user, grant):
    """D-067: the chosen banner id is stored and the job folder keeps its own copy of the image."""
    alice = make_user(app_on, "alice@example.com")
    grant(app_on, alice.user_id, 1_000)
    banner_id = upload_banner(alice)
    job_id = ready_job(alice)
    r = alice.post(f"/api/v1/jobs/{job_id}/approve", json={"banner_id": banner_id})
    assert r.status_code == 200, r.text
    service = app_on.app.state.service  # type: ignore[attr-defined]
    with service.store.engine.connect() as conn:
        stored = conn.execute(
            text("SELECT banner_id FROM jobs WHERE id = :i"), {"i": job_id}
        ).scalar_one()
    assert stored == banner_id
    assert (service.job_dir(job_id) / BANNER_COPY).is_file()
    assert alice.get("/api/v1/wallet").json()["reserved_credits"] > 0


def test_banners_off_needs_no_banner(settings, make_user, grant):  # noqa: F811
    """D-066: with AVATAR_BANNERS=off, approval works as before and stores no banner."""
    with TestClient(create_app(settings, start_poller=False), base_url=HTTPS) as anon:
        alice = make_user(anon, "alice@example.com")
        grant(anon, alice.user_id, 1_000)
        job_id = ready_job(alice)
        assert alice.post(f"/api/v1/jobs/{job_id}/approve").status_code == 200


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are needed to add banners",
)
def test_the_final_video_is_made_from_the_jobs_own_banner_copy(
    charging,  # noqa: F811
    banners_on,  # noqa: F811
    media,  # noqa: F811
    tmp_path,
):
    """D-067, R-44, R-10: the opening (2 s) and closing (3 s) are made from the job's own copy of
    the chosen image at the AI video's size, even after the banner's file is gone; one capture;
    the made clips are cleaned up and the copy is kept."""

    async def run():
        c = setup(charging, banners_on, media, VideoPoll("done", data=media["ai"].read_bytes()))
        with c.store.engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO banners (id, user_id, name, image_file, width, height, "
                    "created_at) VALUES ('b1', :u, 'Logo', 'b1.png', 300, 300, now())"
                ),
                {"u": c.owner},
            )
        source = tmp_path / "b1.png"
        source.write_bytes(logo_png())
        job_id = await c.ready_job()
        c.service.approve_audio(c.owner, job_id, "b1", source)
        await c.drain()
        source.unlink()  # the library file disappears: the job's copy must be enough
        await c.service.poll_once()
        job = c.job(job_id)
        assert job["status"] == db.COMPLETED and job["banners_applied"] is True
        assert job["banner_id"] == "b1"
        folder = c.service.job_dir(job_id)
        ai = measure(folder / "ai_video.mp4")
        final = measure(folder / "video.mp4")
        assert (final.width, final.height) == (ai.width, ai.height)
        # 2.0 s opening + AI + 3.0 s closing, less the two crossfades (0.4 + 0.5 s).
        assert abs(final.duration - (2.0 + ai.duration + 3.0 - 0.9)) < 0.3
        assert (folder / BANNER_COPY).is_file()
        assert not [p.name for p in folder.iterdir() if p.name.startswith(".brand-")]
        captures = [e for e in c.entries() if e[0] == "capture" and e[1].startswith(job_id)]
        assert len(captures) == 1 and c.invariant()

    asyncio.run(run())
