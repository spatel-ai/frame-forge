"""T-505: a job records the saved script it came from, and every script used is saved (R-43, R-51).

Mock provider only; free; no network."""

from dataclasses import replace
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import text

from app.core.config import Settings
from app.main import create_app
from tests.conftest import CONSENT_FORM

HTTPS = "https://testserver"


@pytest.fixture
def client(tmp_path, database_url):
    settings = replace(Settings(), provider="mock", data_dir=tmp_path, database_url=database_url)
    with TestClient(create_app(settings, start_poller=False), base_url=HTTPS) as c:
        yield c


@pytest.fixture
def engine(client):
    return client.app.state.service.store.engine


def png() -> bytes:
    out = BytesIO()
    Image.new("RGB", (512, 512), "teal").save(out, "PNG")
    return out.getvalue()


def post(c, **data):
    return c.post(
        "/api/v1/jobs",
        files={"image": ("me.png", png(), "image/png")},
        data={**CONSENT_FORM, **data},
    )


def scalar(engine, sql, **p):
    with engine.connect() as conn:
        return conn.execute(text(sql), p).scalar_one()


def scripts(engine, uid):
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT * FROM scripts WHERE user_id = :u ORDER BY created_at"), {"u": uid}
        ).all()


@pytest.fixture
def uid(client, sign_up, grant):
    user = sign_up(client)
    grant(client, user, 100)
    return user


def test_pasted_text_is_saved_and_linked(client, engine, uid):
    """R-43: pasted text makes a job, a scripts row, and jobs.script_id points at it."""
    r = post(client, script="Hello there.", language="English")
    assert r.status_code == 201, r.text
    rows = scripts(engine, uid)
    assert len(rows) == 1 and rows[0].text == "Hello there." and rows[0].language == "English"
    assert r.json()["script_id"] == rows[0].id
    assert scalar(engine, "SELECT script_id FROM jobs") == rows[0].id


def test_same_text_again_only_touches_last_used(client, engine, uid):
    """R-43: the same text and language is one row; its last_used_at moves."""
    post(client, script="Hello there.", language="English")
    first = scripts(engine, uid)[0]
    r = post(client, script="Hello there.", language="English")
    assert r.status_code == 201
    rows = scripts(engine, uid)
    assert len(rows) == 1 and rows[0].last_used_at > first.last_used_at
    assert r.json()["script_id"] == first.id


def test_script_id_copies_text_and_language(client, engine, uid):
    """R-43, R-51: a saved script supplies text and language; a sent language is ignored; no
    new row, last_used_at moves."""
    with engine.begin() as conn:
        from app.scripts import service

        sid = service.save_or_touch(conn, uid, "Hindi", "नमस्ते दोस्तों")
    before = scripts(engine, uid)[0].last_used_at
    r = post(client, script_id=sid, language="English")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["script"] == "नमस्ते दोस्तों" and body["language"] == "Hindi"
    assert body["script_id"] == sid
    rows = scripts(engine, uid)
    assert len(rows) == 1 and rows[0].last_used_at > before
    # language may be left out entirely
    assert post(client, script_id=sid).status_code == 201


def test_script_id_checks_still_run_on_the_text(client, engine, uid):
    """The existing length check applies to a saved script's text too; nothing is charged."""
    long_text = "a" * (client.app.state.settings.max_script_chars + 1)
    with engine.begin() as conn:
        from app.scripts import service

        sid = service.save_or_touch(conn, uid, "English", long_text)
    r = post(client, script_id=sid)
    assert r.status_code == 422 and "script" in r.json()["fields"]
    assert scalar(engine, "SELECT count(*) FROM jobs") == 0
    assert client.get("/api/v1/wallet").json()["balance_credits"] == 100


def test_another_users_or_deleted_or_missing_script_is_404(client, engine, uid, make_user, grant):
    """R-12: all three answer script_not_found; nothing is charged and no job exists."""
    other = make_user(client, "other@example.com")
    grant(client, other.user_id, 100)
    sid = post(other, script="Theirs only.", language="English").json()["script_id"]
    mine = post(client, script="Mine.", language="English").json()["script_id"]
    assert client.delete(f"/api/v1/scripts/{mine}").status_code == 204
    jobs_before = scalar(engine, "SELECT count(*) FROM jobs")
    for bad in (sid, mine, "nope"):
        r = post(client, script_id=bad)
        assert r.status_code == 404 and r.json()["code"] == "script_not_found", r.text
    assert scalar(engine, "SELECT count(*) FROM jobs") == jobs_before
    assert client.get("/api/v1/wallet").json()["balance_credits"] == 90  # only the first job


def test_neither_field_is_422_on_script(client, engine, uid):
    r = post(client, language="English")
    assert r.status_code == 422 and "script" in r.json()["fields"], r.text
    assert scalar(engine, "SELECT count(*) FROM jobs") == 0


def test_deleting_the_script_leaves_the_job_unchanged(client, engine, uid):
    """R-50, R-51: the job keeps its text and its script_id after the script is deleted."""
    r = post(client, script="Keep me.", language="English")
    sid = r.json()["script_id"]
    assert client.delete(f"/api/v1/scripts/{sid}").status_code == 204
    job = client.get(f"/api/v1/jobs/{r.json()['id']}").json()
    assert job["script"] == "Keep me." and job["script_id"] == sid


def test_failed_voice_charge_saves_no_script(client, engine, sign_up):
    """The voice charge fails (402): no script row and no job. The route's read-only check is
    bypassed here so the in-transaction charge is what fails."""
    user = sign_up(client)  # no credits granted
    service = client.app.state.service
    from app.jobs.service import NotEnoughCredits

    with pytest.raises(NotEnoughCredits):
        service.create_job(user, png(), "Hello there.", "English", "v")
    assert scalar(engine, "SELECT count(*) FROM scripts") == 0
    assert scalar(engine, "SELECT count(*) FROM jobs") == 0
    assert post(client, script="Hello there.", language="English").status_code == 402
    assert scalar(engine, "SELECT count(*) FROM scripts") == 0
