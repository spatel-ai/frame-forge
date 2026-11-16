"""Accounts and sessions (T-201, T-202). R-01 covers sign-up, login, cookie and passwords;
R-12 covers revoking a session. Mock only: no network, nothing paid."""

import hashlib
import logging
import re
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth.email import LogEmailSender, build_email_sender
from app.core.config import Settings
from app.main import create_app

PASSWORD = "correct horse battery"


class CapturingSender:
    def __init__(self):
        self.sent: list[tuple[str, str, str]] = []

    def send(self, to: str, subject: str, body: str) -> None:
        self.sent.append((to, subject, body))


@pytest.fixture
def sender():
    return CapturingSender()


@pytest.fixture
def app(tmp_path, database_url, sender):
    settings = replace(Settings(), provider="mock", data_dir=tmp_path, database_url=database_url)
    return create_app(settings, start_poller=False, email_sender=sender)


def make_client(app) -> TestClient:
    # https base URL: the session cookie is Secure, so the test client only sends it back
    # over https. Each client has its own cookie jar, which stands in for one device.
    return TestClient(app, base_url="https://testserver")


@pytest.fixture
def client(app):
    with make_client(app) as c:
        yield c


def signup(c, email="Ada@Example.com", name="Ada", password=PASSWORD):
    return c.post("/api/v1/auth/signup", json={"name": name, "email": email, "password": password})


def login(c, email="ada@example.com", password=PASSWORD):
    return c.post("/api/v1/auth/login", json={"email": email, "password": password})


def query(app, sql, **params):
    with app.state.auth_service.store.engine.connect() as conn:
        return conn.execute(text(sql), params).all()


def test_signup_creates_user_session_and_cookie(client, app):
    """R-01: sign-up returns the user, logs them in and stores an Argon2id hash."""
    r = signup(client)
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "ada@example.com" and body["name"] == "Ada"
    assert body["email_verified"] is False and body["role"] == "user"
    assert body["active_sessions"] == 1
    assert "password" not in str(body)
    (row,) = query(app, "SELECT password_hash FROM users")
    assert row[0].startswith("$argon2id$")
    assert client.get("/api/v1/auth/me").json()["id"] == body["id"]


def test_cookie_flags(client):
    """R-01: HttpOnly, Secure, SameSite=Lax, Path=/ and a 30-day lifetime."""
    r = signup(client)
    header = r.headers["set-cookie"].lower()
    for flag in ("httponly", "secure", "samesite=lax", "path=/", f"max-age={30 * 86400}"):
        assert flag in header
    assert header.startswith("ff_session=")


def test_logout_clears_cookie_with_same_attributes(client):
    """R-01: the cleared cookie carries the same flags so the browser really drops it."""
    signup(client)
    header = client.post("/api/v1/auth/logout").headers["set-cookie"].lower()
    for flag in ("httponly", "secure", "samesite=lax", "path=/", "max-age=0"):
        assert flag in header


def test_email_taken_is_409(client):
    """R-01: a second sign-up with the same email (any case) is refused."""
    assert signup(client).status_code == 201
    r = signup(client, email="  ADA@example.com ")
    assert r.status_code == 409
    assert r.json()["code"] == "email_taken"
    assert "log in" in r.json()["detail"].lower()


@pytest.mark.parametrize(
    "payload, fields",
    [
        ({"name": " ", "email": "a@b.co", "password": PASSWORD}, {"name"}),
        ({"name": "x" * 81, "email": "a@b.co", "password": PASSWORD}, {"name"}),
        ({"name": "A", "email": "nope", "password": PASSWORD}, {"email"}),
        ({"name": "A", "email": "a@b", "password": PASSWORD}, {"email"}),
        ({"name": "A", "email": "a@b.co", "password": "short"}, {"password"}),
        ({"name": "A", "email": "a@b.co", "password": "x" * 129}, {"password"}),
        ({"name": "", "email": "", "password": ""}, {"name", "email", "password"}),
    ],
)
def test_signup_validation_carries_fields(client, payload, fields):
    """R-01: each input error is a 422 naming the field, in plain words."""
    r = client.post("/api/v1/auth/signup", json=payload)
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    assert set(body["fields"]) == fields


def test_validation_wording(client):
    """R-01: the agreed messages from the design."""
    r = client.post("/api/v1/auth/signup", json={"name": "A", "email": "x", "password": "short"})
    assert r.json()["fields"]["password"] == "At least 10 characters."
    assert r.json()["fields"]["email"] == "Enter a full email address, like name@example.com."


def test_password_without_composition_rules_and_length_limits(client):
    """R-01: exactly 10 and exactly 128 characters are accepted, whatever they contain."""
    assert signup(client, email="a@b.co", password="aaaaaaaaaa").status_code == 201
    assert signup(client, email="c@d.co", password="a" * 128).status_code == 201


def test_signup_sends_confirmation_email_and_stores_only_hash(client, app, sender):
    """R-01: the email link holds a token; the database holds only its SHA-256 hash."""
    signup(client)
    assert len(sender.sent) == 1
    to, _subject, body = sender.sent[0]
    assert to == "ada@example.com"
    token = re.search(r"/verify-email\?token=([\w-]+)", body).group(1)
    assert body.count("http://localhost:5173/verify-email?token=") == 1
    ((stored, purpose, expires, created),) = query(
        app, "SELECT token_hash, purpose, expires_at, created_at FROM email_tokens"
    )
    assert stored == hashlib.sha256(token.encode()).hexdigest() != token
    assert purpose == "verify"
    assert expires - created == timedelta(hours=24)


def test_new_verification_token_cancels_earlier_ones(client, app):
    """R-01: a new confirmation token makes earlier unused ones unusable."""
    signup(client)
    user_id = client.get("/api/v1/auth/me").json()["id"]
    app.state.auth_service.create_verification_token(user_id)
    rows = query(app, "SELECT used_at FROM email_tokens ORDER BY created_at")
    assert len(rows) == 2 and rows[0][0] is not None and rows[1][0] is None


def test_login_success_and_session_count(app, client):
    """R-01: log in from a second device gets its own session."""
    signup(client)
    with make_client(app) as other:
        r = login(other, email=" ADA@example.com ")
        assert r.status_code == 200 and r.json()["active_sessions"] == 2
        assert "ff_session=" in r.headers["set-cookie"]


def test_unknown_email_and_wrong_password_look_identical(client):
    """R-01: no way to tell a missing account from a wrong password."""
    signup(client)
    wrong = login(client, password="not the password!!")
    unknown = login(client, email="nobody@example.com")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert wrong.json() == {"detail": "Email or password is wrong.", "code": "invalid_credentials"}
    assert "set-cookie" not in wrong.headers


def test_unknown_email_still_verifies_a_hash(client, monkeypatch):
    """R-01: login for an unknown email runs one Argon2 verification (timing parity)."""
    from app.auth import passwords

    calls = []
    real = passwords.verify_password
    monkeypatch.setattr(passwords, "verify_password", lambda h, p: calls.append(h) or real(h, p))
    login(client, email="nobody@example.com")
    assert len(calls) == 1 and calls[0].startswith("$argon2id$")


def test_inactive_user_gets_the_same_401(client, app):
    """R-01: a suspended account cannot log in and is told nothing extra."""
    signup(client)
    with app.state.auth_service.store.engine.begin() as conn:
        conn.execute(text("UPDATE users SET status = 'suspended'"))
    r = login(client)
    assert r.status_code == 401 and r.json()["code"] == "invalid_credentials"
    # An existing session of a suspended user stops working too.
    assert client.get("/api/v1/auth/me").status_code == 401


def test_login_rehashes_an_outdated_hash(client, app):
    """R-01: a hash with older parameters is replaced at login."""
    from argon2 import PasswordHasher

    signup(client)
    weak = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash(PASSWORD)
    with app.state.auth_service.store.engine.begin() as conn:
        conn.execute(text("UPDATE users SET password_hash = :h"), {"h": weak})
    assert login(client).status_code == 200
    (row,) = query(app, "SELECT password_hash FROM users")
    assert row[0] != weak and row[0].startswith("$argon2id$")


def test_me_anonymous_is_401(client):
    """R-01: no cookie, no account details."""
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 401
    assert r.json() == {"detail": "Please log in to continue.", "code": "not_authenticated"}


def test_garbage_cookie_is_401(client):
    """R-01: an unknown token is refused."""
    client.cookies.set("ff_session", "not-a-real-token")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_logout_revokes_the_session(client):
    """R-12: after logout the old cookie is refused, even if the browser kept it."""
    signup(client)
    token = client.cookies.get("ff_session")
    assert client.post("/api/v1/auth/logout").status_code == 204
    client.cookies.set("ff_session", token)
    assert client.get("/api/v1/auth/me").status_code == 401


def test_logout_without_a_session_is_204(client):
    """R-12: logging out when not logged in still succeeds and clears the cookie."""
    r = client.post("/api/v1/auth/logout")
    assert r.status_code == 204
    assert "ff_session=" in r.headers["set-cookie"]


def test_logout_all_revokes_every_session(app, client):
    """R-12: every device is logged out, and an audit entry is written."""
    signup(client)
    with make_client(app) as other:
        login(other)
        assert client.post("/api/v1/auth/logout-all").status_code == 204
        assert other.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/auth/me").status_code == 401
    assert query(app, "SELECT 1 FROM audit_log WHERE action = 'logout_all'")


def test_logout_all_requires_login(client):
    """R-12: anonymous logout-all is 401."""
    assert client.post("/api/v1/auth/logout-all").status_code == 401


def test_session_expires_after_30_days(app, client):
    """R-12: sessions last 30 days with no renewal; expiry is checked against the clock."""
    signup(client)
    ((created, expires),) = query(app, "SELECT created_at, expires_at FROM sessions")
    assert expires - created == timedelta(days=30)
    assert client.get("/api/v1/auth/me").status_code == 200
    service = app.state.auth_service
    service.now = lambda: expires + timedelta(seconds=1)
    assert client.get("/api/v1/auth/me").status_code == 401


def test_expired_sessions_are_not_counted(app, client):
    """R-01: active_sessions leaves out expired and revoked sessions."""
    signup(client)
    with make_client(app) as other:
        login(other)
    store = app.state.auth_service.store
    with store.engine.begin() as conn:
        conn.execute(
            text("UPDATE sessions SET expires_at = :t WHERE id = (SELECT min(id) FROM sessions)"),
            {"t": datetime.now(timezone.utc) - timedelta(days=1)},
        )
    me = client.get("/api/v1/auth/me")
    # `client` owns one of the two sessions; whichever expired, exactly one remains active.
    assert me.status_code in (200, 401)
    user_id = query(app, "SELECT id FROM users")[0][0]
    assert store.count_active_sessions(user_id, app.state.auth_service.now()) == 1


def test_change_password_keeps_this_session_and_ends_others(app, client):
    """R-01 / R-12: other devices are logged out; this one stays; the old password stops working."""
    signup(client)
    with make_client(app) as other:
        login(other)
        r = client.post(
            "/api/v1/auth/password/change",
            json={"current_password": PASSWORD, "new_password": "a brand new secret"},
        )
        assert r.status_code == 204
        assert other.get("/api/v1/auth/me").status_code == 401
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200 and me.json()["active_sessions"] == 1
    assert login(client, password=PASSWORD).status_code == 401
    assert login(client, password="a brand new secret").status_code == 200
    (row,) = query(app, "SELECT detail FROM audit_log WHERE action = 'password_change'")
    assert row[0] is None


def test_change_password_wrong_current(client):
    """R-01: a wrong current password is a 422 on that field."""
    signup(client)
    r = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": "nope nope nope", "new_password": "a brand new secret"},
    )
    assert r.status_code == 422
    assert r.json()["fields"] == {"current_password": "That is not your current password."}


def test_change_password_short_new_password(client):
    """R-01: the new password follows the sign-up rule."""
    signup(client)
    r = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": PASSWORD, "new_password": "short"},
    )
    assert r.status_code == 422
    assert r.json()["fields"] == {"new_password": "At least 10 characters."}


def test_change_password_requires_login(client):
    """R-01: anonymous change is 401."""
    r = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": PASSWORD, "new_password": "a brand new secret"},
    )
    assert r.status_code == 401


def test_audit_log_never_holds_email_or_password(app, client):
    """R-01: audit rows exist for sign-up and login and contain no email or password."""
    signup(client)
    login(client)
    rows = query(app, "SELECT action, actor_user_id, target, detail FROM audit_log")
    assert {r[0] for r in rows} == {"signup", "login"}
    flat = " ".join(str(c) for r in rows for c in r)
    assert "example.com" not in flat and PASSWORD not in flat


def test_only_hashes_of_session_tokens_are_stored(app, client):
    """R-01: the cookie value never appears in the database."""
    signup(client)
    token = client.cookies.get("ff_session")
    ((stored,),) = query(app, "SELECT token_hash FROM sessions")
    assert stored == hashlib.sha256(token.encode()).hexdigest() != token


def test_secrets_are_not_logged_by_the_app(app, caplog):
    """R-01: with the injected sender, no log line holds the password, email or tokens."""
    caplog.set_level(logging.DEBUG)
    with make_client(app) as c:
        signup(c)
        login(c, password="wrong wrong wrong")
        token = c.cookies.get("ff_session")
    text_logged = caplog.text
    assert PASSWORD not in text_logged and "ada@example.com" not in text_logged
    assert token not in text_logged


def test_log_sender_is_the_only_place_that_logs_the_address(caplog):
    """R-01: the development sender writes to app.auth.email at INFO."""
    caplog.set_level(logging.INFO)
    LogEmailSender().send("ada@example.com", "Hi", "link")
    assert [r.name for r in caplog.records] == ["app.auth.email"]


def test_production_without_provider_refuses_to_start(tmp_path, database_url):
    """R-01: production must not silently drop confirmation emails."""
    settings = replace(Settings(), environment="production", database_url=database_url)
    with pytest.raises(RuntimeError, match="no email provider"):
        build_email_sender(settings)
    with pytest.raises(RuntimeError, match="no email provider"):
        with TestClient(create_app(settings, start_poller=False)):
            pass
