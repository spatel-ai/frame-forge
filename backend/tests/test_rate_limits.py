"""Rate limits (T-205, decision D-035). R-01 covers sign-up, login and reset abuse.
Mock only: no network, nothing paid. The service clock is moved to cross window edges."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from test_auth import CapturingSender, login, signup

from app.auth.ratelimit import RateLimiter, Rule
from app.core.config import Settings
from app.main import create_app

EMAIL = "ada@example.com"


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


def forgot(c, email=EMAIL):
    return c.post("/api/v1/auth/password/forgot", json={"email": email})


def bad_login(c, email=EMAIL):
    return login(c, email=email, password="wrong password here")


def move_clock(app, seconds):
    base = datetime.now(timezone.utc)
    app.state.auth_service.now = lambda: base + timedelta(seconds=seconds)


def assert_limited(r):
    assert r.status_code == 429
    body = r.json()
    assert body["code"] == "rate_limited"
    assert "Too many attempts. Please wait" in body["detail"]
    assert int(r.headers["retry-after"]) >= 1
    return body


def test_limiter_sliding_window_edges():
    """R-01: the limit is exact at window edges and expired entries are dropped."""
    now = [1000.0]
    lim = RateLimiter(lambda: now[0])
    rule = Rule("k", 2, 10)
    assert lim.hit(rule) is None
    now[0] += 5
    assert lim.hit(rule) is None
    assert lim.hit(rule) == 5  # oldest leaves the window in 5 s; a refused hit is not counted
    now[0] += 5  # the first hit is now exactly 10 s old: out of the window
    assert lim.hit(rule) is None
    for i in range(600):  # idle keys are swept, so memory stays bounded
        lim.hit(Rule(f"x{i}", 1, 1))
        now[0] += 2
    assert lim.size() < 300


def test_login_throttled_after_five_failures_then_window_passes(client, app):
    """R-01: the 6th attempt in 15 minutes gets 429 + Retry-After, even with the right password."""
    signup(client)
    for _ in range(5):
        assert bad_login(client).status_code == 401
    assert_limited(login(client))  # correct password, but the counter is full
    assert_limited(bad_login(client))
    # Another email from the same address is a different pair.
    assert bad_login(client, "other@example.com").status_code == 401
    move_clock(app, 15 * 60 + 1)
    assert login(client).status_code == 200


def test_login_window_boundary_uses_clock(client, app):
    """R-01: still blocked just inside the window, allowed just after it."""
    signup(client)
    base = datetime.now(timezone.utc)
    app.state.auth_service.now = lambda: base
    for _ in range(5):
        bad_login(client)
    app.state.auth_service.now = lambda: base + timedelta(minutes=15) - timedelta(seconds=2)
    assert_limited(login(client))
    app.state.auth_service.now = lambda: base + timedelta(minutes=15, seconds=1)
    assert login(client).status_code == 200


def test_successful_login_resets_counter(client):
    """R-01: a good login clears that pair's failures."""
    signup(client)
    for _ in range(4):
        assert bad_login(client).status_code == 401
    assert login(client).status_code == 200
    for _ in range(5):
        assert bad_login(client).status_code == 401
    assert_limited(bad_login(client))


def test_login_limit_counts_unknown_email_too(client):
    """R-01: an unknown email is throttled the same way, so the limit leaks nothing."""
    for _ in range(5):
        assert bad_login(client, "nobody@example.com").status_code == 401
    assert_limited(bad_login(client, "nobody@example.com"))


def test_signup_limit_five_per_address_per_hour(client, app):
    """R-01: the 5th sign-up from an address passes, the 6th gets 429; every attempt counts."""
    for i in range(4):
        assert signup(client, email=f"u{i}@example.com").status_code == 201
    assert signup(client, name="").status_code == 422  # an invalid attempt counts (the 5th)
    assert_limited(signup(client, email="u9@example.com"))
    move_clock(app, 3601)
    assert signup(client, email="u9@example.com").status_code == 201


def test_forgot_limit_per_email_identical_for_real_and_unknown(client, sender):
    """R-01: 3 per email per hour; 429 is identical for a real and an unknown email."""
    signup(client)
    sender.sent.clear()
    results = []
    for email in (EMAIL, "nobody@example.com"):
        for _ in range(3):
            assert forgot(client, email).status_code == 202
        r = forgot(client, email)
        results.append((r.status_code, r.json(), r.headers["retry-after"]))
        assert_limited(r)
    assert results[0] == results[1]
    assert len(sender.sent) == 3  # only the real account got mail, and only 3 times


def test_forgot_limit_normalises_email(client):
    """R-01: the forgot counter uses the trimmed, lower-case address."""
    for e in ("A@Example.com", " a@example.com ", "a@EXAMPLE.com"):
        assert forgot(client, e).status_code == 202
    assert_limited(forgot(client, "a@example.com"))


def test_forgot_limit_ten_per_address(client, app):
    """R-01: 10 per client address per hour across different emails."""
    for i in range(10):
        assert forgot(client, f"p{i}@example.com").status_code == 202
    assert_limited(forgot(client, "p10@example.com"))
    move_clock(app, 3601)
    assert forgot(client, "p10@example.com").status_code == 202


def test_forgot_malformed_email_is_422(client):
    """R-01: validation errors still come first and do not use the quota."""
    assert forgot(client, "nope").status_code == 422


def test_resend_limit_three_per_email_per_hour(client, app):
    """R-01: the 3rd resend passes, the 4th gets 429; the window then passes."""
    signup(client)
    for _ in range(3):
        assert client.post("/api/v1/auth/verify-email/resend").status_code == 204
    assert_limited(client.post("/api/v1/auth/verify-email/resend"))
    move_clock(app, 3601)
    assert client.post("/api/v1/auth/verify-email/resend").status_code == 204


def test_resend_unauthenticated_is_401_not_limited(client):
    """R-01: the limit applies to the logged-in user, not before authentication."""
    for _ in range(5):
        assert client.post("/api/v1/auth/verify-email/resend").status_code == 401


def test_limiter_is_per_app(app, client):
    """R-01: each app has its own limiter, so tests do not share counters."""
    assert app.state.auth_service.limiter.size() == 0
