"""Email confirmation and password reset (T-203). R-01 covers single-use hashed tokens, expiry,
the same answer for known and unknown emails and password rules; R-12 covers revoking sessions.
Mock only: no network, nothing paid."""

import hashlib
import logging
import re
import threading
from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth.service import hash_token, utcnow
from app.core.config import Settings
from app.main import create_app

PASSWORD = "correct horse battery"
NEW_PASSWORD = "a brand new passphrase"
A = "/api/v1/auth"
EMAIL = "ada@example.com"


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


@pytest.fixture
def client(app):
    with TestClient(app, base_url="https://testserver") as c:
        yield c


def signup(c, email=EMAIL):
    r = c.post(f"{A}/signup", json={"name": "Ada", "email": email, "password": PASSWORD})
    assert r.status_code == 201
    return r.json()


def query(app, sql, **params):
    with app.state.auth_service.store.engine.connect() as conn:
        return conn.execute(text(sql), params).all()


def link_token(body: str, path: str) -> str:
    match = re.search(rf"/{path}\?token=([\w-]+)", body)
    assert match
    return match.group(1)


def forgot(c, email=EMAIL):
    return c.post(f"{A}/password/forgot", json={"email": email})


def reset_token(sender) -> str:
    return link_token(sender.sent[-1][2], "reset-password")


def verify_token(sender) -> str:
    return link_token(sender.sent[0][2], "verify-email")


def post_reset(c, token, password=NEW_PASSWORD):
    return c.post(f"{A}/password/reset", json={"token": token, "password": password})


def log_in(c, password):
    return c.post(f"{A}/login", json={"email": EMAIL, "password": password})


# confirmation ------------------------------------------------------------------------------


def test_verify_email_sets_verified_and_shows_in_me(app, client, sender):
    """R-01: confirming needs no login and /me then shows email_verified true."""
    signup(client)
    token = verify_token(sender)
    with TestClient(app, base_url="https://testserver") as anon:
        assert anon.post(f"{A}/verify-email", json={"token": token}).status_code == 204
    assert client.get(f"{A}/me").json()["email_verified"] is True


def test_verify_token_is_single_use(client, sender):
    """R-01: the same confirmation token fails the second time with the agreed answer."""
    signup(client)
    token = verify_token(sender)
    assert client.post(f"{A}/verify-email", json={"token": token}).status_code == 204
    r = client.post(f"{A}/verify-email", json={"token": token})
    assert r.status_code == 400 and r.json()["code"] == "verify_link_invalid"
    assert r.json()["detail"] == "This link has expired or was already used. Ask for a new one."


def test_verify_unknown_token_same_answer(client):
    """R-01: an unknown token gets the same 400 as a used one."""
    r = client.post(f"{A}/verify-email", json={"token": "nope"})
    assert r.status_code == 400 and r.json()["code"] == "verify_link_invalid"


def test_verify_token_expires_after_24_hours(app, client, sender):
    """R-01: one second before 24 hours works, one second after does not."""
    signup(client)
    token = verify_token(sender)
    ((created,),) = query(app, "SELECT created_at FROM email_tokens")
    svc = app.state.auth_service
    svc.now = lambda: created + timedelta(hours=24, seconds=1)
    assert client.post(f"{A}/verify-email", json={"token": token}).status_code == 400
    svc.now = lambda: created + timedelta(hours=24) - timedelta(seconds=1)
    assert client.post(f"{A}/verify-email", json={"token": token}).status_code == 204


def test_resend_needs_login(app):
    """R-01: resend while logged out is 401."""
    with TestClient(app, base_url="https://testserver") as anon:
        assert anon.post(f"{A}/verify-email/resend").status_code == 401


def test_resend_sends_new_link_and_cancels_old(client, sender):
    """R-01: resend emails a new link; the earlier link stops working."""
    signup(client)
    old = verify_token(sender)
    assert client.post(f"{A}/verify-email/resend").status_code == 204
    assert len(sender.sent) == 2
    new = link_token(sender.sent[1][2], "verify-email")
    assert client.post(f"{A}/verify-email", json={"token": old}).status_code == 400
    assert client.post(f"{A}/verify-email", json={"token": new}).status_code == 204


def test_resend_when_confirmed_sends_nothing(client, sender):
    """R-01: an already confirmed account gets 204 and no email."""
    signup(client)
    client.post(f"{A}/verify-email", json={"token": verify_token(sender)})
    assert client.post(f"{A}/verify-email/resend").status_code == 204
    assert len(sender.sent) == 1


# forgot ------------------------------------------------------------------------------------


def test_forgot_same_answer_and_email_only_for_real_account(app, client, sender):
    """R-01: unknown, inactive and real accounts get the same 202 and body; only the real one
    is emailed."""
    signup(client)
    signup(client, email="sus@example.com")
    with app.state.auth_service.store.engine.begin() as conn:
        conn.execute(text("UPDATE users SET status = 'suspended' WHERE email = 'sus@example.com'"))
    before = len(sender.sent)
    answers = []
    for email in ("nobody@example.com", "sus@example.com"):
        r = forgot(client, email)
        answers.append((r.status_code, r.content))
        assert len(sender.sent) == before
    r = forgot(client, "ADA@example.com")
    answers.append((r.status_code, r.content))
    assert len(sender.sent) == before + 1
    assert sender.sent[-1][0] == EMAIL
    assert len(set(answers)) == 1 and answers[0][0] == 202


def test_forgot_malformed_email_is_422(client):
    """R-01: a malformed email may be refused; that reveals nothing."""
    r = forgot(client, "nope")
    assert r.status_code == 422 and "email" in r.json()["fields"]


def test_reset_token_hashed_30_minutes_and_link(app, client, sender):
    """R-01: the link carries the token, the database holds only its hash, expiry is 30 min."""
    signup(client)
    forgot(client)
    body = sender.sent[-1][2]
    token = reset_token(sender)
    assert "http://localhost:5173/reset-password?token=" in body
    assert "once" in body and "30 minutes" in body
    ((stored, created, expires),) = query(
        app,
        "SELECT token_hash, created_at, expires_at FROM email_tokens WHERE purpose = 'reset'",
    )
    assert stored == hashlib.sha256(token.encode()).hexdigest() != token
    assert expires - created == timedelta(minutes=30)
    raw = query(
        app,
        "SELECT count(*) FROM email_tokens WHERE token_hash IN (:a, :b)",
        a=token,
        b=verify_token(sender),
    )
    assert raw[0][0] == 0


def test_asking_again_cancels_earlier_reset_link(client, sender):
    """R-01: a second request makes the first link unusable."""
    signup(client)
    forgot(client)
    first = reset_token(sender)
    forgot(client)
    second = reset_token(sender)
    assert first != second
    r = post_reset(client, first)
    assert r.status_code == 400 and r.json()["code"] == "reset_link_invalid"
    assert client.post(f"{A}/password/reset/check", json={"token": second}).status_code == 200


def test_check_reports_email_and_does_not_consume(client, sender):
    """R-01: check shows the address and the link still works afterwards."""
    signup(client)
    forgot(client)
    token = reset_token(sender)
    for _ in range(2):
        r = client.post(f"{A}/password/reset/check", json={"token": token})
        assert r.status_code == 200 and r.json() == {"email": EMAIL}
    assert post_reset(client, token).status_code == 204


def test_check_invalid_token(client):
    """R-01: unknown token gets reset_link_invalid."""
    r = client.post(f"{A}/password/reset/check", json={"token": "nope"})
    assert r.status_code == 400 and r.json()["code"] == "reset_link_invalid"
    assert r.json()["detail"] == "This link has expired or was already used. Ask for a new one."


def test_reset_token_expires_after_30_minutes(app, client, sender):
    """R-01: one second before 30 minutes works, one second after does not (check and reset)."""
    signup(client)
    forgot(client)
    token = reset_token(sender)
    ((created,),) = query(app, "SELECT created_at FROM email_tokens WHERE purpose = 'reset'")
    svc = app.state.auth_service
    svc.now = lambda: created + timedelta(minutes=30, seconds=1)
    r = client.post(f"{A}/password/reset/check", json={"token": token})
    assert r.status_code == 400 and r.json()["code"] == "reset_link_invalid"
    r = post_reset(client, token)
    assert r.status_code == 400 and r.json()["code"] == "reset_link_invalid"
    svc.now = lambda: created + timedelta(minutes=30) - timedelta(seconds=1)
    assert post_reset(client, token).status_code == 204


# reset -------------------------------------------------------------------------------------


def test_reset_changes_password_revokes_sessions_and_notifies(app, client, sender):
    """R-01, R-12: reset stores a new Argon2id hash, ends every session, audits without secrets,
    emails a notice, clears the cookie and confirms the email."""
    signup(client)
    with TestClient(app, base_url="https://testserver") as other:
        assert log_in(other, PASSWORD).status_code == 200
        forgot(client)
        token = reset_token(sender)
        with TestClient(app, base_url="https://testserver") as anon:
            r = post_reset(anon, token)
        assert r.status_code == 204
        cookie = r.headers["set-cookie"].lower()
        assert "ff_session=" in cookie and "max-age=0" in cookie
        assert other.get(f"{A}/me").status_code == 401
    assert client.get(f"{A}/me").status_code == 401  # the old cookie is dead
    assert query(app, "SELECT count(*) FROM sessions WHERE revoked_at IS NULL")[0][0] == 0
    assert log_in(client, PASSWORD).status_code == 401
    fresh = log_in(client, NEW_PASSWORD)
    assert fresh.status_code == 200 and fresh.json()["email_verified"] is True
    (row,) = query(app, "SELECT password_hash FROM users")
    assert row[0].startswith("$argon2id$")
    ((detail,),) = query(app, "SELECT detail FROM audit_log WHERE action = 'password_reset'")
    assert detail is None
    to, subject, body = sender.sent[-1]
    assert to == EMAIL and "changed" in subject.lower()
    assert NEW_PASSWORD not in body and token not in body


def test_reset_token_single_use(client, sender):
    """R-01: the same reset token used twice fails the second time."""
    signup(client)
    forgot(client)
    token = reset_token(sender)
    assert post_reset(client, token).status_code == 204
    r = post_reset(client, token, "another passphrase")
    assert r.status_code == 400 and r.json()["code"] == "reset_link_invalid"
    assert log_in(client, NEW_PASSWORD).status_code == 200


@pytest.mark.parametrize("password", ["short", "x" * 129])
def test_bad_password_is_422_and_link_survives(client, sender, password):
    """R-01: a refused password does not burn the link."""
    signup(client)
    forgot(client)
    token = reset_token(sender)
    r = post_reset(client, token, password)
    assert r.status_code == 422 and r.json()["code"] == "validation_error"
    assert set(r.json()["fields"]) == {"password"}
    assert post_reset(client, token).status_code == 204


def test_reset_unknown_token(client):
    """R-01: unknown token on reset gets reset_link_invalid."""
    r = post_reset(client, "nope")
    assert r.status_code == 400 and r.json()["code"] == "reset_link_invalid"


def test_wrong_purpose_token_is_refused(client, sender):
    """R-01: a confirmation token cannot reset a password, nor the other way round."""
    signup(client)
    forgot(client)
    assert post_reset(client, verify_token(sender)).status_code == 400
    assert client.post(f"{A}/verify-email", json={"token": reset_token(sender)}).status_code == 400


def test_reset_rolls_back_as_one_transaction(app, client, sender):
    """R-01, R-12: if the audit write fails, the token, password and sessions are untouched."""
    signup(client)
    forgot(client)
    token = reset_token(sender)
    engine = app.state.auth_service.store.engine
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE audit_log ADD CONSTRAINT no_reset CHECK (action <> 'password_reset')")
        )
    try:
        with TestClient(app, base_url="https://testserver", raise_server_exceptions=False) as c:
            assert post_reset(c, token).status_code == 500
    finally:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE audit_log DROP CONSTRAINT no_reset"))
    assert client.get(f"{A}/me").status_code == 200
    assert client.post(f"{A}/password/reset/check", json={"token": token}).status_code == 200


def test_race_two_consumes_one_winner(app, client, sender):
    """R-01: two simultaneous consumes of one token; exactly one wins."""
    signup(client)
    forgot(client)
    h = hash_token(reset_token(sender))
    store = app.state.auth_service.store
    now = utcnow()
    results: list = []
    barrier = threading.Barrier(2)

    def go():
        barrier.wait()
        results.append(store.consume_email_token("reset", h, now))

    threads = [threading.Thread(target=go) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sum(r is not None for r in results) == 1


def test_race_two_resets_one_winner(app, client, sender):
    """R-01: two simultaneous reset requests with one link; one 204, one 400."""
    signup(client)
    forgot(client)
    token = reset_token(sender)
    codes: list[int] = []
    barrier = threading.Barrier(2)

    def go(pw):
        with TestClient(app, base_url="https://testserver") as c:
            barrier.wait()
            codes.append(post_reset(c, token, pw).status_code)

    threads = [threading.Thread(target=go, args=(p,)) for p in (NEW_PASSWORD, "second passphrase")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(codes) == [204, 400]


# logging -----------------------------------------------------------------------------------


def test_no_token_or_email_in_app_logs(client, sender, caplog):
    """R-01: nothing in the app logs holds a token, password or email (the test sender is not a
    logger, so the dev LogEmailSender is the only place that may)."""
    caplog.set_level(logging.DEBUG)
    signup(client)
    forgot(client)
    forgot(client, "nobody@example.com")
    token = reset_token(sender)
    client.post(f"{A}/password/reset/check", json={"token": token})
    post_reset(client, token)
    post_reset(client, token)
    vtoken = verify_token(sender)
    client.post(f"{A}/verify-email", json={"token": vtoken})
    logged = caplog.text
    for secret in (token, vtoken, NEW_PASSWORD, PASSWORD, EMAIL, "nobody@example.com"):
        assert secret not in logged
