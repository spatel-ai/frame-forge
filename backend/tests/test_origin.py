"""Origin check (T-205, decision D-035). R-01: other websites cannot make a logged-in
customer's browser change anything. Mock only."""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from test_auth import CapturingSender, signup

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def app(tmp_path, database_url):
    settings = replace(Settings(), provider="mock", data_dir=tmp_path, database_url=database_url)
    return create_app(settings, start_poller=False, email_sender=CapturingSender())


@pytest.fixture
def client(app):
    with TestClient(app, base_url="https://testserver") as c:
        yield c


FOREIGN = {"Origin": "https://evil.example"}
ALLOWED = {"Origin": "http://localhost:5173"}
OUT = "/api/v1/auth/logout"


def assert_refused(r):
    assert r.status_code == 403
    assert r.json() == {
        "detail": "This request came from another website and was refused.",
        "code": "origin_refused",
    }


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_foreign_origin_refused_on_every_changing_method(client, method):
    """R-01: a foreign Origin is refused on POST, PUT, PATCH and DELETE, on any path."""
    assert_refused(client.request(method, "/api/v1/anything", headers=FOREIGN))


def test_cross_site_fetch_metadata_refused_without_origin(client):
    """R-01: no Origin plus Sec-Fetch-Site: cross-site is refused."""
    assert_refused(client.post(OUT, headers={"Sec-Fetch-Site": "cross-site"}))


def test_refusal_stops_the_action(client):
    """R-01: a refused cross-site logout leaves the session alive."""
    signup(client)
    assert_refused(client.post(OUT, headers=FOREIGN))
    assert client.get("/api/v1/auth/me").status_code == 200


def test_allowed_and_absent_origin_pass(client):
    """R-01: allowed origins, no headers, and same-origin fetches pass."""
    assert client.post(OUT, headers=ALLOWED).status_code == 204
    assert client.post(OUT, headers={"Origin": "http://127.0.0.1:5173"}).status_code == 204
    assert client.post(OUT).status_code == 204
    assert client.post(OUT, headers={"Sec-Fetch-Site": "same-origin"}).status_code == 204
    # A present allowed Origin decides; Sec-Fetch-Site is only read when Origin is absent.
    assert client.post(OUT, headers={**ALLOWED, "Sec-Fetch-Site": "cross-site"}).status_code == 204


def test_get_is_never_checked(client):
    """R-01: GET is not checked, even with a foreign origin or cross-site metadata."""
    assert client.get("/api/v1/health", headers=FOREIGN).status_code != 403
    r = client.get("/api/v1/auth/me", headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 401


def test_origin_null_refused(client):
    """R-01: the opaque `null` origin is not on the list."""
    assert_refused(client.post(OUT, headers={"Origin": "null"}))


def test_allowed_origins_setting_from_env(monkeypatch):
    """R-01: AVATAR_ALLOWED_ORIGINS is comma-separated; the default is the two dev origins."""
    monkeypatch.delenv("AVATAR_ALLOWED_ORIGINS", raising=False)
    assert Settings().allowed_origins == ("http://localhost:5173", "http://127.0.0.1:5173")
    monkeypatch.setenv("AVATAR_ALLOWED_ORIGINS", " https://a.example , https://b.example ,")
    assert Settings().allowed_origins == ("https://a.example", "https://b.example")
