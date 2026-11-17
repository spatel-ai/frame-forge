"""T-502 (R-14, D-045): a job cannot be created without recorded consent. Mock only: no network."""

from dataclasses import replace
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text

from app.core.config import Settings
from app.main import create_app
from tests.conftest import CONSENT_VERSION

HTTPS = "https://testserver"
TICK = "Tick the box to confirm you have permission to use this photo."


def png() -> bytes:
    out = BytesIO()
    Image.new("RGB", (512, 512), "teal").save(out, "PNG")
    return out.getvalue()


@pytest.fixture
def settings(tmp_path, database_url):
    return replace(Settings(), provider="mock", data_dir=tmp_path, database_url=database_url)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings, start_poller=False), base_url=HTTPS) as c:
        yield c


def _post(client, **form):
    return client.post(
        "/api/v1/jobs",
        files={"image": ("me.png", png(), "image/png")},
        data={"script": "Hello there.", "language": "English", **form},
    )


def _nothing_made(client, settings, credits: int) -> None:
    engine = client.app.state.service.store.engine
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM jobs")).scalar_one() == 0
    assert client.get("/api/v1/wallet").json()["balance_credits"] == credits
    assert not list(settings.jobs_dir.glob("*"))


@pytest.mark.parametrize(
    "form",
    [
        {},
        {"consent_version": CONSENT_VERSION},
        {"consent": "false", "consent_version": CONSENT_VERSION},
    ],
)
def test_missing_or_false_consent_is_422_and_nothing_is_made(
    client, settings, sign_up, grant, form
):
    """R-14: no consent, no job, no ledger entry, no file."""
    grant(client, sign_up(client), 100)
    r = _post(client, **form)
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["code"] == "consent_required"
    assert body["fields"] == {"consent": TICK}
    _nothing_made(client, settings, 100)


@pytest.mark.parametrize("version", [None, "", "1999-01-01"])
def test_stale_or_missing_version_is_422_consent_outdated(
    client, settings, sign_up, grant, version
):
    """R-14: the wording the customer saw is not the current one; nothing is charged."""
    grant(client, sign_up(client), 100)
    form = {"consent": "true"}
    if version is not None:
        form["consent_version"] = version
    r = _post(client, **form)
    assert r.status_code == 422, r.text
    assert r.json()["code"] == "consent_outdated"
    assert "Reload" in r.json()["fields"]["consent"]
    _nothing_made(client, settings, 100)


def test_consent_is_recorded_with_the_job(client, sign_up, grant):
    """R-14, D-045: the job stores the version and time; JobOut.consent_at returns it."""
    grant(client, sign_up(client), 100)
    r = _post(client, consent="true", consent_version=CONSENT_VERSION)
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["consent_at"] is not None and job["consent_at"].endswith("+00:00")
    engine = client.app.state.service.store.engine
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT consent_version, consent_at FROM jobs WHERE id = :i"), {"i": job["id"]}
        ).one()
    assert row.consent_version == CONSENT_VERSION and row.consent_at is not None
    assert client.get(f"/api/v1/jobs/{job['id']}").json()["consent_at"] == job["consent_at"]


def test_no_credits_is_402_before_the_consent_check(client, sign_up):
    """Error order: 401, 403, 402, then input validation including consent."""
    sign_up(client)
    r = _post(client)
    assert r.status_code == 402, r.text
    assert r.json()["code"] == "insufficient_credits"
