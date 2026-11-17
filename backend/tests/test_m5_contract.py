"""The M5 contract (T-500): job list, saved voices, scripts, templates, the M5 job fields and the
daily video limit. R-11, R-13, R-14, R-43, R-44, R-83. Mock only: no network.

Routes that are not built answer 501 `not_implemented`; the M5 fields on POST /jobs answer 501
and charge nothing until their task is built (docs/M5-PLAN.md)."""

from dataclasses import replace
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text

from app.core.config import Settings
from app.jobs.routes import _failure_kind, _voice_reusable
from app.main import create_app
from tests.conftest import CONSENT_FORM

HTTPS = "https://testserver"


def _openapi():
    return create_app().openapi()


def png() -> bytes:
    out = BytesIO()
    Image.new("RGB", (512, 512), "teal").save(out, "PNG")
    return out.getvalue()


# ---- the OpenAPI document ---------------------------------------------------------------


def test_m5_routes_are_in_the_contract():
    """R-13, R-43, R-44, R-83: the M5 routes exist, need a session and document their errors."""
    paths = _openapi()["paths"]
    jobs = paths["/api/v1/jobs"]["get"]
    assert set(jobs["responses"]) >= {"200", "401", "422"}
    assert {p["name"] for p in jobs["parameters"]} == {"page", "page_size", "status", "q"}
    assert set(paths["/api/v1/voices"]["get"]["responses"]) >= {"200", "401"}
    scripts = paths["/api/v1/scripts"]["get"]
    assert {p["name"] for p in scripts["parameters"]} == {"page", "page_size", "q", "language"}
    assert set(paths["/api/v1/scripts/{script_id}"]["get"]["responses"]) >= {"200", "401", "404"}
    assert set(paths["/api/v1/scripts/{script_id}"]["delete"]["responses"]) >= {"204", "404"}
    assert set(paths["/api/v1/templates"]["get"]["responses"]) >= {"200", "401"}
    preview = paths["/api/v1/templates/{template_id}/preview"]["get"]
    assert set(preview["responses"]) >= {"200", "401", "404"}


def test_create_job_takes_the_m5_fields_and_approve_documents_the_daily_limit():
    """R-11, R-14, R-43, R-44, R-83: consent, saved script, banners and saved voice are form
    fields of POST /jobs; approve can answer 429 daily_limit_reached."""
    paths = _openapi()["paths"]
    create = paths["/api/v1/jobs"]["post"]
    ref = create["requestBody"]["content"]["multipart/form-data"]["schema"]["$ref"]
    form = _openapi()["components"]["schemas"][ref.rsplit("/", 1)[1]]["properties"]
    assert {
        "image",
        "script",
        "language",
        "consent",
        "consent_version",
        "script_id",
        "start_template_id",
        "end_template_id",
        "voice_from_job_id",
    } <= set(form)
    assert {"404", "429"} <= set(create["responses"])
    assert "429" in paths["/api/v1/jobs/{job_id}/approve"]["post"]["responses"]


def test_m5_shapes():
    """R-13, R-53, R-83: the job carries the cost split, the failure kind and the banner state;
    the job status includes the joining step; config carries consent and the daily limit."""
    schemas = _openapi()["components"]["schemas"]
    job = schemas["JobOut"]["properties"]
    assert {
        "voice_credits",
        "video_credits",
        "failure_kind",
        "voice_reusable",
        "needs_review",
        "consent_at",
        "script_id",
        "voice_from_job_id",
        "start_template",
        "end_template",
        "banners_applied",
    } <= set(job)
    status = schemas["JobOut"]["properties"]["status"]
    assert "video_assembling" in str(status) or "video_assembling" in str(schemas)
    config = schemas["ConfigOut"]["properties"]
    assert {"consent_version", "consent_text", "daily_video_limit"} <= set(config)
    for name in ("JobsOut", "JobSummaryOut", "SavedVoicesOut", "ScriptsOut", "TemplatesOut"):
        assert name in schemas
    assert set(schemas["TemplateOut"]["properties"]["kind"]["enum"]) == {"start", "end"}


# ---- derived job fields -------------------------------------------------------------------


def _job(**over):
    base = {
        "status": "failed",
        "audio_file": None,
        "audio_duration_seconds": None,
        "approve_attempt": 0,
        "needs_review": False,
    }
    return {**base, **over}


@pytest.mark.parametrize(
    ("job", "kind"),
    [
        (_job(status="completed", audio_file="a.mp3", approve_attempt=1), None),
        (_job(), "voice_failed"),
        (_job(needs_review=True), "voice_unknown"),
        (_job(audio_file="a.mp3", audio_duration_seconds=75.0), "voice_too_long"),
        (_job(audio_file="a.mp3", audio_duration_seconds=12.0, approve_attempt=1), "video_failed"),
        (
            _job(
                audio_file="a.mp3",
                audio_duration_seconds=12.0,
                approve_attempt=1,
                needs_review=True,
            ),
            "video_unknown",
        ),
    ],
)
def test_failure_kind_follows_the_failure_screens(job, kind):
    """R-83, D-040, D-048, D-051: each failure ending maps to one kind from stored state."""
    assert _failure_kind(job) == kind


def test_a_voice_is_reusable_only_when_failed_and_within_the_limit():
    """R-83, D-043, D-056: a failed job's voice within the length limit can start a new job."""
    settings = Settings()
    assert _voice_reusable(settings, _job(audio_file="a.mp3", audio_duration_seconds=12.0))
    assert not _voice_reusable(settings, _job(audio_file="a.mp3", audio_duration_seconds=75.0))
    assert not _voice_reusable(settings, _job())
    done = _job(status="completed", audio_file="a.mp3", audio_duration_seconds=12.0)
    assert not _voice_reusable(settings, done)


def test_daily_limit_applies_outside_production_only():
    """R-11, D-046: 50 a day in development and testing; no limit in production."""
    assert Settings().effective_daily_video_limit == 50
    live = replace(
        Settings(),
        environment="production",
        payments="razorpay",
        razorpay_key_id="rzp_live_placeholder",
        razorpay_key_secret="placeholder",
        razorpay_webhook_secret="placeholder",
    )
    assert live.effective_daily_video_limit is None


# ---- the running app ----------------------------------------------------------------------


@pytest.fixture
def client(tmp_path, database_url):
    settings = replace(Settings(), provider="mock", data_dir=tmp_path, database_url=database_url)
    with TestClient(create_app(settings, start_poller=False), base_url=HTTPS) as c:
        yield c


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/v1/voices"),
        ("get", "/api/v1/templates"),
        ("get", "/api/v1/templates/abc/preview"),
    ],
)
def test_unbuilt_routes_need_a_session_then_answer_501(client, sign_up, method, path):
    """R-13: anonymous is 401; a logged-in caller gets 501 not_implemented until built."""
    assert getattr(client, method)(path).status_code == 401
    sign_up(client)
    r = getattr(client, method)(path)
    assert r.status_code == 501, r.text
    assert r.json()["code"] == "not_implemented"


@pytest.mark.parametrize(
    "extra",
    [
        {"script_id": "s1"},
        {"start_template_id": "t1"},
        {"end_template_id": "t2"},
        {"voice_from_job_id": "j1"},
    ],
)
def test_m5_job_fields_answer_501_and_charge_nothing(client, sign_up, grant, extra):
    """R-14: an M5 field is never silently ignored before its task is built; nothing is made or
    charged."""
    user = sign_up(client)
    grant(client, user, 100)
    r = client.post(
        "/api/v1/jobs",
        files={"image": ("me.png", png(), "image/png")},
        data={"script": "Hello there.", "language": "English", **extra},
    )
    assert r.status_code == 501, r.text
    engine = client.app.state.service.store.engine  # type: ignore[attr-defined]
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM jobs")).scalar_one() == 0
    assert client.get("/api/v1/wallet").json()["balance_credits"] == 100


def test_today_job_fields_have_real_values(client, sign_up, grant):
    """R-13: a job made today reports its voice cost and no M5 data it does not have."""
    user = sign_up(client)
    grant(client, user, 100)
    r = client.post(
        "/api/v1/jobs",
        files={"image": ("me.png", png(), "image/png")},
        data={**CONSENT_FORM, "script": "Hello there.", "language": "English"},
    )
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["voice_credits"] == 10 and job["video_credits"] == 0
    assert job["charged_credits"] == job["voice_credits"] + job["video_credits"]
    assert job["failure_kind"] is None and job["voice_reusable"] is False
    assert job["needs_review"] is False
    assert job["consent_at"] is not None  # T-502: set from the consent given
    for name in (
        "script_id",
        "voice_from_job_id",
        "start_template",
        "end_template",
        "banners_applied",
    ):
        assert job[name] is None


def test_config_reports_consent_and_the_daily_limit(client):
    """R-14, R-11: consent wording and version, and the limit in force."""
    cfg = client.get("/api/v1/config").json()
    assert cfg["consent_version"] == "2026-11-17"
    assert cfg["consent_text"].startswith("I am the person in this photo")
    assert cfg["daily_video_limit"] == 50
