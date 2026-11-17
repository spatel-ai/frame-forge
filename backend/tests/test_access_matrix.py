"""T-206: the access-control matrix (R-12 for config and job routes, R-01 for auth routes).

Every Frameforge API route appears in one of two tables below, with the expected answer for each
actor. The completeness guard fails when a route is added to the OpenAPI document without an
entry here, so a new route cannot ship without an access decision.

Each matrix row runs against its own database schema and its own app, so a row that changes state
(logout-all, approve) cannot affect another row. Mock provider only; free; no network."""

from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from io import BytesIO
from typing import Literal

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import Engine, text

from app.core.config import Settings
from app.jobs import db
from app.main import create_app

HTTPS = "https://testserver"  # the session cookie is Secure, so the client must be https
PASSWORD = "correct horse battery"
EMAILS = {
    "owner": "owner@example.com",
    "other": "other@example.com",
    "admin": "admin@example.com",
    "unconfirmed": "unconfirmed@example.com",
}

Actor = Literal["anonymous", "owner", "other", "admin", "unconfirmed"]
JobKey = Literal["owner", "unconfirmed", "ownerless"]
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


@dataclass(frozen=True)
class Row:
    """One route, one actor, and the answer the app must give."""

    method: str
    path: str  # the OpenAPI path template
    actor: Actor
    status: int
    code: str | None = None
    job: JobKey | None = None  # which job the {job_id} in the path names

    @property
    def ref(self) -> str:
        if self.actor == "unconfirmed":
            return "R-12 R-01"  # the email-confirmation rule (D-036) is an R-01 rule
        return "R-01" if self.path.startswith("/api/v1/auth/") else "R-12"

    @property
    def name(self) -> str:
        suffix = f" on {self.job} job" if self.job else ""
        return f"{self.ref} {self.method} {self.path} {self.actor}{suffix}"


@dataclass(frozen=True)
class Public:
    """A public auth route: anonymous callers reach it, and it never answers not_authenticated."""

    method: str
    path: str
    body: dict | None
    accepted: tuple[int, ...]
    code: str | None = None

    @property
    def name(self) -> str:
        return f"R-01 {self.method} {self.path} anonymous"


ROWS: list[Row] = [
    # Config and health: public to everyone (R-12).
    *[
        Row("GET", "/api/v1/config", actor, 200)
        for actor in ("anonymous", "owner", "other", "admin")
    ],
    *[Row("GET", "/healthz", actor, 200) for actor in ("anonymous", "owner", "other", "admin")],
    # Own account (R-01). Admin gets no extra power here; it sees only its own user.
    Row("GET", "/api/v1/auth/me", "anonymous", 401, "not_authenticated"),
    Row("GET", "/api/v1/auth/me", "owner", 200),
    Row("GET", "/api/v1/auth/me", "other", 200),
    Row("GET", "/api/v1/auth/me", "admin", 200),
    Row("POST", "/api/v1/auth/logout-all", "anonymous", 401, "not_authenticated"),
    Row("POST", "/api/v1/auth/logout-all", "owner", 204),
    Row("POST", "/api/v1/auth/verify-email/resend", "anonymous", 401, "not_authenticated"),
    Row("POST", "/api/v1/auth/verify-email/resend", "owner", 204),
    Row("POST", "/api/v1/auth/password/change", "anonymous", 401, "not_authenticated"),
    Row("POST", "/api/v1/auth/password/change", "owner", 422, "validation_error"),
    # Job create (R-12, R-01 for the confirmed-email rule).
    Row("POST", "/api/v1/jobs", "anonymous", 401, "not_authenticated"),
    Row("POST", "/api/v1/jobs", "owner", 201),
    Row("POST", "/api/v1/jobs", "unconfirmed", 403, "email_not_verified"),
    # The owner's job: other users and admin get 404, never 403 (R-12).
    Row("GET", "/api/v1/jobs/{job_id}", "anonymous", 401, "not_authenticated", job="owner"),
    Row("GET", "/api/v1/jobs/{job_id}", "owner", 200, job="owner"),
    Row("GET", "/api/v1/jobs/{job_id}", "other", 404, "job_not_found", job="owner"),
    Row("GET", "/api/v1/jobs/{job_id}", "admin", 404, "job_not_found", job="owner"),
    Row(
        "POST", "/api/v1/jobs/{job_id}/approve", "anonymous", 401, "not_authenticated", job="owner"
    ),
    Row("POST", "/api/v1/jobs/{job_id}/approve", "owner", 200, job="owner"),
    Row("POST", "/api/v1/jobs/{job_id}/approve", "other", 404, "job_not_found", job="owner"),
    Row("POST", "/api/v1/jobs/{job_id}/approve", "admin", 404, "job_not_found", job="owner"),
    Row(
        "POST",
        "/api/v1/jobs/{job_id}/approve",
        "unconfirmed",
        403,
        "email_not_verified",
        job="unconfirmed",
    ),
    Row("GET", "/api/v1/jobs/{job_id}/audio", "anonymous", 401, "not_authenticated", job="owner"),
    Row("GET", "/api/v1/jobs/{job_id}/audio", "owner", 200, job="owner"),
    Row("GET", "/api/v1/jobs/{job_id}/audio", "other", 404, "job_not_found", job="owner"),
    Row("GET", "/api/v1/jobs/{job_id}/audio", "admin", 404, "job_not_found", job="owner"),
    Row("GET", "/api/v1/jobs/{job_id}/video", "anonymous", 401, "not_authenticated", job="owner"),
    Row("GET", "/api/v1/jobs/{job_id}/video", "owner", 404, "not_available_yet", job="owner"),
    Row("GET", "/api/v1/jobs/{job_id}/video", "other", 404, "job_not_found", job="owner"),
    Row("GET", "/api/v1/jobs/{job_id}/video", "admin", 404, "job_not_found", job="owner"),
    # M3 wallet (T-300 contract). Owner and other-user rows arrive with T-306, when the routes
    # stop answering 501.
    Row("GET", "/api/v1/wallet", "anonymous", 401, "not_authenticated"),
    Row("GET", "/api/v1/wallet/transactions", "anonymous", 401, "not_authenticated"),
    # A job with no owner (made before accounts) is shown to nobody who is logged in (R-12).
    *[
        Row(method, path, actor, 404, "job_not_found", job="ownerless")
        for method, path in (
            ("GET", "/api/v1/jobs/{job_id}"),
            ("POST", "/api/v1/jobs/{job_id}/approve"),
            ("GET", "/api/v1/jobs/{job_id}/audio"),
            ("GET", "/api/v1/jobs/{job_id}/video"),
        )
        for actor in ("owner", "other", "admin")
    ],
]

# Public auth routes (R-01): no session needed. Anonymous must not get 401 not_authenticated.
PUBLIC: list[Public] = [
    Public(
        "POST",
        "/api/v1/auth/signup",
        {"name": "Public", "email": "public@example.com", "password": PASSWORD},
        (201,),
    ),
    Public(
        "POST",
        "/api/v1/auth/login",
        {"email": "nobody@example.com", "password": PASSWORD},
        (401,),
        "invalid_credentials",
    ),
    Public("POST", "/api/v1/auth/logout", None, (204,)),
    Public(
        "POST",
        "/api/v1/auth/verify-email",
        {"token": "not-a-real-token"},
        (400,),
        "verify_link_invalid",
    ),
    Public("POST", "/api/v1/auth/password/forgot", {"email": "nobody@example.com"}, (202,)),
    Public(
        "POST",
        "/api/v1/auth/password/reset/check",
        {"token": "not-a-real-token"},
        (400,),
        "reset_link_invalid",
    ),
    Public(
        "POST",
        "/api/v1/auth/password/reset",
        {"token": "not-a-real-token", "password": PASSWORD},
        (400,),
        "reset_link_invalid",
    ),
]


def png() -> bytes:
    out = BytesIO()
    Image.new("RGB", (512, 512), "teal").save(out, "PNG")
    return out.getvalue()


def post_job(client: TestClient) -> httpx.Response:
    return client.post(
        "/api/v1/jobs",
        files={"image": ("me.png", png(), "image/png")},
        data={"script": "Hello.", "language": "English"},
    )


def send(client: TestClient, method: str, path: str) -> httpx.Response:
    if path == "/api/v1/jobs":
        return post_job(client)
    if path == "/api/v1/auth/password/change":
        return client.post(path, json={})  # an empty body is a 422 for a logged-in owner
    return client.request(method, path)


def engine_of(client: TestClient) -> Engine:
    return client.app.state.service.store.engine  # type: ignore[attr-defined]


def run_sql(client: TestClient, sql: str, **params: str) -> None:
    with engine_of(client).begin() as conn:
        conn.execute(text(sql), params)


def create_job(client: TestClient) -> str:
    r = post_job(client)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def ownerless_job(client: TestClient, owner_id: str) -> str:
    """A job as it exists from before accounts: audio_ready, with no owner."""
    job_id = "f" * 32
    store = client.app.state.service.store  # type: ignore[attr-defined]
    store.create(job_id, owner_id, "English", "hi", "image.png")
    run_sql(
        client, "UPDATE jobs SET user_id = NULL, status = 'audio_ready' WHERE id = :i", i=job_id
    )
    return job_id


@dataclass
class World:
    clients: dict[Actor, TestClient]
    jobs: dict[JobKey, str]
    emails: dict[str, str] = field(default_factory=lambda: dict(EMAILS))


@pytest.fixture
def settings(tmp_path, database_url) -> Settings:
    return replace(
        Settings(),
        provider="mock",
        data_dir=tmp_path,
        poll_interval_seconds=0.05,
        database_url=database_url,
    )


@pytest.fixture
def world(settings, make_user) -> Iterator[World]:
    """Four users and two jobs in one fresh app. `start_poller=False` keeps jobs where they are."""
    with TestClient(create_app(settings, start_poller=False), base_url=HTTPS) as anon:
        owner = make_user(anon, EMAILS["owner"])
        other = make_user(anon, EMAILS["other"])
        admin = make_user(anon, EMAILS["admin"])
        unconfirmed = make_user(anon, EMAILS["unconfirmed"])
        run_sql(anon, "UPDATE users SET role = 'admin' WHERE email = :e", e=EMAILS["admin"])
        owner_job = create_job(owner)  # mock voice is synchronous: audio_ready
        # An unconfirmed user cannot create a job, so the job is made first and the email is then
        # un-confirmed. This is the "owner whose email is not confirmed" for approve.
        unconfirmed_job = create_job(unconfirmed)
        run_sql(
            anon,
            "UPDATE users SET email_verified_at = NULL WHERE email = :e",
            e=EMAILS["unconfirmed"],
        )
        ownerless = ownerless_job(anon, owner.user_id)
        yield World(
            clients={
                "anonymous": anon,
                "owner": owner,
                "other": other,
                "admin": admin,
                "unconfirmed": unconfirmed,
            },
            jobs={"owner": owner_job, "unconfirmed": unconfirmed_job, "ownerless": ownerless},
        )


@pytest.fixture
def bare(settings) -> Iterator[TestClient]:
    """An https client on an app with no users: the anonymous caller alone."""
    with TestClient(create_app(settings, start_poller=False), base_url=HTTPS) as c:
        yield c


@pytest.mark.parametrize("row", ROWS, ids=[r.name for r in ROWS])
def test_access_matrix(world: World, row: Row) -> None:
    """R-12 (R-01 on auth routes): each row is one route and one actor, and the app answers with
    the expected status and error code. Another user's resource is 404, never 403."""
    path = row.path
    if row.job is not None:
        path = row.path.format(job_id=world.jobs[row.job])
    r = send(world.clients[row.actor], row.method, path)
    assert r.status_code == row.status, r.text
    if row.code is not None:
        assert r.json()["code"] == row.code, r.text
    if row.path == "/api/v1/auth/me" and row.status == 200:
        body = r.json()
        assert body["email"] == world.emails[row.actor]
        assert body["role"] == ("admin" if row.actor == "admin" else "user")


@pytest.mark.parametrize("route", PUBLIC, ids=[p.name for p in PUBLIC])
def test_public_auth_route_needs_no_session(bare: TestClient, route: Public) -> None:
    """R-01: a public auth route answers an anonymous caller. It never answers not_authenticated;
    login's 401 is invalid_credentials."""
    r = bare.request(route.method, route.path, json=route.body)
    assert r.status_code in route.accepted, r.text
    if route.code is not None:
        assert r.json()["code"] == route.code, r.text


def test_other_users_approve_leaves_the_owners_job_unchanged(world: World) -> None:
    """R-12: another user's approve gets 404 job_not_found, and the owner's job keeps its status."""
    job_id = world.jobs["owner"]
    owner = world.clients["owner"]
    before = owner.get(f"/api/v1/jobs/{job_id}").json()["status"]
    assert before == db.AUDIO_READY
    r = world.clients["other"].post(f"/api/v1/jobs/{job_id}/approve")
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "job_not_found"
    assert owner.get(f"/api/v1/jobs/{job_id}").json()["status"] == before


def test_every_documented_route_has_an_access_decision(settings) -> None:
    """R-12 and R-01: every (method, path) in the OpenAPI document is in the matrix or the public
    list, and every matrix entry is a real route. HEAD and OPTIONS are not checked."""
    paths = create_app(settings).openapi()["paths"]
    documented = {
        (method.upper(), path)
        for path, operations in paths.items()
        for method in operations
        if method in HTTP_METHODS
    }
    covered = {(r.method, r.path) for r in ROWS} | {(p.method, p.path) for p in PUBLIC}
    assert documented - covered == set(), "routes with no access decision in the matrix"
    assert covered - documented == set(), "matrix entries for routes that do not exist"
