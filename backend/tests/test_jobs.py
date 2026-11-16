"""All tests use the mock provider or stubs: nothing here calls fal.ai."""

import asyncio
import time
from dataclasses import replace
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings
from app.jobs import db
from app.jobs.db import JobStore
from app.jobs.service import Conflict, JobService, ValidationError
from app.main import create_app
from app.providers import MockProvider, ProviderError, VideoPoll


def png(size=(512, 512)) -> bytes:
    out = BytesIO()
    Image.new("RGB", size, "teal").save(out, "PNG")
    return out.getvalue()


@pytest.fixture
def settings(tmp_path, database_url):
    # database_url (tests/conftest.py) is a freshly migrated schema private to this test.
    return replace(
        Settings(),
        provider="mock",
        data_dir=tmp_path,
        poll_interval_seconds=0.05,
        database_url=database_url,
    )


# The `seed_user` fixture (tests/conftest.py), made reachable from make_service.
_seed_user: list = []


@pytest.fixture(autouse=True)
def _seeder(seed_user):
    _seed_user[:] = [seed_user]


# Stores opened by make_service; closed after each test so no connection outlives it.
_open_stores: list[JobStore] = []


@pytest.fixture(autouse=True)
def _close_stores(settings):
    # Depends on `settings`, so it is torn down before the test's schema is dropped.
    yield
    while _open_stores:
        _open_stores.pop().close()


class OwnedService(JobService):
    """A JobService plus the id of the confirmed user that owns the test's jobs (T-204)."""

    owner_id: str


def make_service(settings, provider=None) -> OwnedService:
    store = JobStore(settings.database_url)
    _open_stores.append(store)
    service = OwnedService(settings, store, provider or MockProvider(settings))
    service.owner_id = _seed_user[0](settings.database_url)
    return service


async def drain(service: JobService) -> None:
    while service._tasks:
        await asyncio.gather(*list(service._tasks))


async def ready_job(service: JobService, script="Hello there, this is a test.") -> str:
    job = service.create_job(service.owner_id, png(), script, "English")
    assert job["status"] == db.AUDIO_GENERATING
    await drain(service)
    return job["id"]


# ---- lifecycle ----------------------------------------------------------


def test_full_flow_reaches_completed_with_files_on_disk(settings):
    async def run():
        service = make_service(settings)
        job_id = await ready_job(service)
        job = service.store.get(job_id)
        assert job["status"] == db.AUDIO_READY
        assert job["audio_duration_seconds"] > 0
        assert (service.job_dir(job_id) / job["audio_file"]).stat().st_size > 0

        assert service.approve_audio(service.owner_id, job_id)["status"] == db.VIDEO_SUBMITTING
        await drain(service)
        job = service.store.get(job_id)
        assert job["status"] == db.VIDEO_GENERATING
        assert job["provider_request_id"]

        await service.poll_once()
        assert service.store.get(job_id)["status"] == db.VIDEO_GENERATING
        await service.poll_once()
        job = service.store.get(job_id)
        assert job["status"] == db.COMPLETED
        assert (service.job_dir(job_id) / job["video_file"]).stat().st_size > 0

    asyncio.run(run())


def test_no_video_is_submitted_without_approval(settings):
    async def run():
        service = make_service(settings)
        await ready_job(service)
        await service.poll_once()
        assert service.provider.submit_count == 0

    asyncio.run(run())


def test_second_approval_is_rejected_and_only_one_video_is_submitted(settings):
    async def run():
        service = make_service(settings)
        job_id = await ready_job(service)
        service.approve_audio(service.owner_id, job_id)
        with pytest.raises(Conflict):
            service.approve_audio(service.owner_id, job_id)
        await drain(service)
        with pytest.raises(Conflict):
            service.approve_audio(service.owner_id, job_id)
        assert service.provider.submit_count == 1

    asyncio.run(run())


def test_audio_over_the_limit_fails_and_cannot_be_approved(settings):
    async def run():
        service = make_service(settings)
        # The mock speaks 15 characters a second, so 400 characters at 12 is 33 seconds.
        service.provider.chars_per_second = 12.0
        job_id = await ready_job(service, script="a" * 400)
        job = service.store.get(job_id)
        assert job["status"] == db.FAILED
        assert "30 seconds" in job["error"]
        with pytest.raises(Conflict):
            service.approve_audio(service.owner_id, job_id)
        assert service.provider.submit_count == 0

    asyncio.run(run())


def test_voice_failure_marks_the_job_failed(settings):
    class Broken(MockProvider):
        async def synthesize_speech(self, text, language):
            raise ProviderError("Voice generation failed: boom")

    async def run():
        service = make_service(settings, Broken(settings))
        job = service.store.get(await ready_job(service))
        assert job["status"] == db.FAILED
        assert "boom" in job["error"]

    asyncio.run(run())


def test_upload_failure_returns_to_audio_ready_and_can_be_approved_again(settings):
    class FlakyUpload(MockProvider):
        fail = True

        async def upload_inputs(self, image, audio):
            if self.fail:
                raise ProviderError("Uploading inputs failed: network")
            return await super().upload_inputs(image, audio)

    async def run():
        provider = FlakyUpload(settings)
        service = make_service(settings, provider)
        job_id = await ready_job(service)
        service.approve_audio(service.owner_id, job_id)
        await drain(service)
        job = service.store.get(job_id)
        assert job["status"] == db.AUDIO_READY
        assert "Nothing was charged" in job["error"]
        assert provider.submit_count == 0

        provider.fail = False
        service.approve_audio(service.owner_id, job_id)
        await drain(service)
        job = service.store.get(job_id)
        assert job["status"] == db.VIDEO_GENERATING
        assert job["error"] is None
        assert provider.submit_count == 1

    asyncio.run(run())


def test_submit_failure_is_final_and_never_retried(settings):
    class BrokenSubmit(MockProvider):
        async def submit_video(self, image_ref, audio_ref):
            self.submit_count += 1
            raise TimeoutError("no response")

    async def run():
        provider = BrokenSubmit(settings)
        service = make_service(settings, provider)
        job_id = await ready_job(service)
        service.approve_audio(service.owner_id, job_id)
        await drain(service)
        job = service.store.get(job_id)
        assert job["status"] == db.FAILED
        assert "double charge" in job["error"]
        with pytest.raises(Conflict):
            service.approve_audio(service.owner_id, job_id)
        assert provider.submit_count == 1

    asyncio.run(run())


# ---- polling and restart recovery ----------------------------------------


class ScriptedPolls(MockProvider):
    """Returns queued poll outcomes; an Exception in the queue is raised."""

    def __init__(self, settings, outcomes):
        super().__init__(settings)
        self.outcomes = list(outcomes)

    async def poll_video(self, request_id):
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def test_transient_poll_error_is_retried_then_completes(settings):
    async def run():
        provider = ScriptedPolls(
            settings, [ConnectionError("blip"), VideoPoll("done", data=b"video-bytes")]
        )
        service = make_service(settings, provider)
        job_id = await ready_job(service)
        service.approve_audio(service.owner_id, job_id)
        await drain(service)
        await service.poll_once()
        assert service.store.get(job_id)["status"] == db.VIDEO_GENERATING
        await service.poll_once()
        assert service.store.get(job_id)["status"] == db.COMPLETED
        assert (service.job_dir(job_id) / "video.mp4").read_bytes() == b"video-bytes"

    asyncio.run(run())


def test_provider_reported_failure_marks_the_job_failed(settings):
    async def run():
        provider = ScriptedPolls(
            settings, [VideoPoll("failed", error="Video generation failed: x")]
        )
        service = make_service(settings, provider)
        job_id = await ready_job(service)
        service.approve_audio(service.owner_id, job_id)
        await drain(service)
        await service.poll_once()
        job = service.store.get(job_id)
        assert (job["status"], job["error"]) == (db.FAILED, "Video generation failed: x")

    asyncio.run(run())


def test_video_that_never_finishes_times_out(settings):
    async def run():
        provider = ScriptedPolls(settings, [VideoPoll("pending")])
        service = make_service(replace(settings, video_timeout_seconds=-1), provider)
        job_id = await ready_job(service)
        service.approve_audio(service.owner_id, job_id)
        await drain(service)
        await service.poll_once()
        job = service.store.get(job_id)
        assert job["status"] == db.FAILED
        assert job["provider_request_id"] in job["error"]

    asyncio.run(run())


def test_restart_resumes_submitted_video_without_resubmitting(settings):
    async def run():
        first = make_service(settings)
        job_id = await ready_job(first)
        first.approve_audio(first.owner_id, job_id)
        await drain(first)
        request_id = first.store.get(job_id)["provider_request_id"]
        first.store.close()

        # A new process: fresh service and provider over the same database.
        provider = ScriptedPolls(settings, [VideoPoll("done", data=b"after-restart")])
        second = make_service(settings, provider)
        second.recover_interrupted()
        job = second.store.get(job_id)
        assert (job["status"], job["provider_request_id"]) == (db.VIDEO_GENERATING, request_id)
        await second.poll_once()
        assert second.store.get(job_id)["status"] == db.COMPLETED
        assert provider.submit_count == 0

    asyncio.run(run())


def test_restart_fails_jobs_cut_off_mid_call_instead_of_rerunning_them(settings):
    async def run():
        service = make_service(settings)
        mid_voice = service.store.create("a" * 32, service.owner_id, "English", "hi", "image.png")[
            "id"
        ]
        mid_submit = await ready_job(service)
        service.store.transition(mid_submit, db.AUDIO_READY, db.VIDEO_SUBMITTING)
        service.recover_interrupted()
        await drain(service)
        assert service.store.get(mid_voice)["status"] == db.FAILED
        job = service.store.get(mid_submit)
        assert job["status"] == db.FAILED
        assert "double charge" in job["error"]
        assert service.provider.submit_count == 0

    asyncio.run(run())


# ---- input validation -----------------------------------------------------


@pytest.mark.parametrize(
    "image, script, language, expected",
    [
        (b"not an image", "hi", "English", "not a readable image"),
        (b"", "hi", "English", "empty"),
        (png((100, 100)), "hi", "English", "at least 256"),
        (png(), "   ", "English", "script is empty"),
        (png(), "a" * 401, "English", "longer than 400"),
        (png(), "hi", "French", "Language must be"),
        (png(), "ਸਤ ਸ੍ਰੀ ਅਕਾਲ", "English", "written in Punjabi"),
        (png(), "ਸਤ ਸ੍ਰੀ ਅਕਾਲ", "Hindi", "written in Punjabi"),
        (png(), "नमस्ते दोस्तों", "English", "written in Hindi"),
        (png(), "नमस्ते दोस्तों", "Punjabi", "written in Hindi"),
    ],
)
def test_invalid_input_is_rejected_before_any_provider_call(
    settings, image, script, language, expected
):
    async def run():
        service = make_service(settings)
        with pytest.raises(ValidationError, match=expected):
            service.create_job(service.owner_id, image, script, language)
        assert not list(settings.jobs_dir.glob("*"))

    asyncio.run(run())


def test_gif_is_rejected(settings):
    async def run():
        out = BytesIO()
        Image.new("RGB", (512, 512)).save(out, "GIF")
        svc = make_service(settings)
        with pytest.raises(ValidationError, match="JPEG, PNG or WebP"):
            svc.create_job(svc.owner_id, out.getvalue(), "hi", "English")

    asyncio.run(run())


# ---- HTTP API -------------------------------------------------------------


def wait_for(client, job_id, status, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{job_id}").json()
        if job["status"] == status:
            return job
        time.sleep(0.05)
    raise AssertionError(f"job stayed {job['status']}, expected {status}: {job}")


def test_http_flow_end_to_end(settings, sign_up):
    with TestClient(create_app(settings), base_url="https://testserver") as client:
        sign_up(client)
        assert client.get("/api/v1/config").json()["provider"] == "mock"

        created = client.post(
            "/api/v1/jobs",
            files={"image": ("me.png", png(), "image/png")},
            data={"script": "Hello from the test suite.", "language": "Hindi"},
        )
        assert created.status_code == 201
        job_id = created.json()["id"]

        job = wait_for(client, job_id, "audio_ready")
        assert job["estimated_video_cost_usd"] == round(job["audio_duration_seconds"] * 0.0562, 2)
        assert client.get(job["audio_url"]).status_code == 200
        assert client.get(f"/api/v1/jobs/{job_id}/video").status_code == 404

        assert client.post(f"/api/v1/jobs/{job_id}/approve").status_code == 200
        assert client.post(f"/api/v1/jobs/{job_id}/approve").status_code == 409

        job = wait_for(client, job_id, "completed")
        video = client.get(job["video_url"])
        assert video.status_code == 200 and len(video.content) > 0


def test_http_errors(settings, sign_up):
    with TestClient(create_app(settings), base_url="https://testserver") as client:
        sign_up(client)
        assert client.get("/api/v1/jobs/nope").status_code == 404
        assert client.post("/api/v1/jobs/nope/approve").status_code == 404
        bad = client.post(
            "/api/v1/jobs",
            files={"image": ("x.png", b"junk", "image/png")},
            data={"script": "hi", "language": "English"},
        )
        assert bad.status_code == 422
        assert bad.json()["detail"].startswith("The file is not a readable image.")
        too_big = client.post(
            "/api/v1/jobs",
            files={"image": ("x.png", b"0" * (10 * 1024 * 1024 + 1), "image/png")},
            data={"script": "hi", "language": "English"},
        )
        assert too_big.status_code == 422
        assert "larger than 10 MB" in too_big.json()["detail"]


def test_audio_duration_is_measured_from_wav_and_mp3(settings, tmp_path):
    import subprocess

    from app.providers import audio_duration_seconds

    async def run():
        speech = await MockProvider(settings).synthesize_speech("a" * 45, "English")
        assert await audio_duration_seconds(speech.data) == pytest.approx(3.0, abs=0.01)
        wav, mp3 = tmp_path / "a.wav", tmp_path / "a.mp3"
        wav.write_bytes(speech.data)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-i", wav, mp3], check=True)
        assert await audio_duration_seconds(mp3.read_bytes()) == pytest.approx(3.0, abs=0.15)
        with pytest.raises(ProviderError):
            await audio_duration_seconds(b"not audio")

    asyncio.run(run())


def test_refused_video_submission_keeps_the_audio_for_another_approval(settings):
    class Refuses(MockProvider):
        refuse = True

        async def submit_video(self, image_ref, audio_ref):
            if self.refuse:
                raise ProviderError("Video generation was refused: balance exhausted.")
            return await super().submit_video(image_ref, audio_ref)

    async def run():
        provider = Refuses(settings)
        service = make_service(settings, provider)
        job_id = await ready_job(service)
        service.approve_audio(service.owner_id, job_id)
        await drain(service)
        job = service.store.get(job_id)
        assert job["status"] == db.AUDIO_READY
        assert "balance exhausted" in job["error"]

        provider.refuse = False
        service.approve_audio(service.owner_id, job_id)
        await drain(service)
        assert service.store.get(job_id)["status"] == db.VIDEO_GENERATING
        assert provider.submit_count == 1

    asyncio.run(run())


def test_fal_errors_are_explained(settings):
    import httpx
    from fal_client.client import FalClientHTTPError, FalClientTimeoutError

    from app.providers import FalProvider

    provider = FalProvider(settings)
    locked = FalClientHTTPError(
        "User is locked. Reason: Exhausted balance.", 403, {}, httpx.Response(403)
    )
    assert "Nothing was charged" in provider._explain("Voice generation", locked)
    assert "cancelled" in provider._explain("Voice generation", FalClientTimeoutError(90.0, "r"))
    assert provider._explain("Voice generation", ValueError("x")) == "Voice generation failed: x"


def test_fal_arguments_per_language(settings):
    from app.providers import FalProvider

    calls = []

    class FakeFal:
        async def subscribe_async(self, model, arguments, client_timeout):
            calls.append((model, arguments))
            raise RuntimeError("stop before any network call")

    async def run():
        provider = FalProvider(settings)
        provider._fal = FakeFal()
        for language in ("English", "Hindi", "Punjabi"):
            with pytest.raises(ProviderError):
                await provider.synthesize_speech("hi", language)

    asyncio.run(run())
    assert calls[0] == (
        "fal-ai/minimax/speech-02-hd",
        {"text": "hi", "language_boost": "English", "output_format": "url"},
    )
    assert calls[1][1]["language_boost"] == "Hindi"
    assert calls[2] == (
        "fal-ai/gemini-3.1-flash-tts",
        {
            "prompt": "hi",
            "voice": "Charon",
            "language_code": "Punjabi (India)",
            "output_format": "wav",
        },
    )


def test_script_in_its_own_language_is_accepted(settings):
    async def run():
        service = make_service(settings)
        for script, language in (("ਸਤ ਸ੍ਰੀ ਅਕਾਲ। AI", "Punjabi"), ("नमस्ते दोस्तों", "Hindi")):
            assert (
                service.create_job(service.owner_id, png(), script, language)["language"]
                == language
            )
        await drain(service)

    asyncio.run(run())
