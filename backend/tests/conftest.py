"""Shared database fixtures (decision D-024).

Every test that needs the database gets its own uniquely named schema in the
Docker PostgreSQL (`docker compose up -d db`) and drops it afterwards, so tests
never touch the shared `public` schema or each other's data. Free: nothing here
reaches fal.ai or any paid service."""

import uuid
from dataclasses import dataclass
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import NullPool

from app.core.config import Settings

BACKEND_DIR = Path(__file__).resolve().parent.parent
SCHEMA_PREFIX = "test_t_"
# T-502 (R-14, D-045): POST /jobs needs the consent form fields; tests that create a job send these.
CONSENT_VERSION = Settings().consent_version
CONSENT_FORM = {"consent": "true", "consent_version": CONSENT_VERSION}


@dataclass(frozen=True)
class TestSchema:
    __test__ = False  # not a test class

    name: str
    url: str  # database URL whose search_path is this schema only

    def alembic_config(self) -> Config:
        cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        cfg.set_main_option("sqlalchemy.url", self.url.replace("%", "%%"))
        cfg.attributes["configure_logger"] = False
        return cfg


@pytest.fixture(autouse=True)
def _no_real_email(monkeypatch):
    """Tests never send real email: the owner's Gmail login, if exported in the shell, is
    removed for every test (R1 email gate). Tests that need SMTP patch smtplib and set values."""
    monkeypatch.delenv("USER_EMAIL", raising=False)
    monkeypatch.delenv("USER_EMAIL_PASSWORD", raising=False)


@pytest.fixture(scope="session")
def admin_engine():
    # NullPool: no connection is held between schema create and drop.
    engine = create_engine(Settings().database_url, poolclass=NullPool)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except OperationalError as exc:
        pytest.fail(
            "PostgreSQL is unreachable. Run `docker compose up -d db` from the repo root "
            f"and try again. ({type(exc).__name__})"
        )
    yield engine
    engine.dispose()


@pytest.fixture
def empty_schema(admin_engine: Engine):
    """A new, empty schema, dropped with everything in it after the test."""
    name = f"{SCHEMA_PREFIX}{uuid.uuid4().hex[:12]}"
    with admin_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{name}"'))
    scoped = make_url(Settings().database_url).update_query_dict(
        {"options": f"-csearch_path={name}"}
    )
    try:
        yield TestSchema(name, scoped.render_as_string(hide_password=False))
    finally:
        with admin_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{name}" CASCADE'))


@pytest.fixture
def database_url(empty_schema: TestSchema) -> str:
    """URL of a schema migrated to Alembic head, private to this test."""
    command.upgrade(empty_schema.alembic_config(), "head")
    return empty_schema.url


# ---- users for tests of routes that need a login (T-204) -------------------

PASSWORD = "correct horse battery"


def confirm_email(engine: Engine, email: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET email_verified_at = now() WHERE email = :e"), {"e": email}
        )


def grant_credits(
    target: Engine | str | TestClient, user_id: str, credits: int, ref: str = "test-grant"
) -> None:
    """Give a user credits through the ledger (T-304: creating a job charges the voice, approving
    holds the price). Opt-in: new users start at 0. `target` is an engine, a database URL or a
    started TestClient. A repeat with the same `ref` is a no-op (rule 9)."""
    from app.wallet import ledger

    if isinstance(target, TestClient):
        target = target.app.state.service.store.engine  # type: ignore[attr-defined]
    engine = create_engine(target, poolclass=NullPool) if isinstance(target, str) else target
    try:
        with engine.begin() as conn:
            ledger.grant(conn, user_id, credits, f"{ref}-{user_id}", None)
    finally:
        if isinstance(target, str):
            engine.dispose()


@pytest.fixture
def grant():
    """`grant(engine_or_url_or_client, user_id, credits, ref=...)`: see `grant_credits`."""
    return grant_credits


class UserClient(TestClient):
    """An https client (the session cookie is Secure) that carries one user's cookie."""

    user_id: str
    email: str


@pytest.fixture
def sign_up():
    """`sign_up(client, email=..., confirmed=True)`: sign a new user up through the real route on
    `client`, which keeps the session cookie, and mark the email confirmed unless told not to.
    `client` must be a started https TestClient. Returns the user id."""

    def make(client: TestClient, email: str = "owner@example.com", confirmed: bool = True) -> str:
        r = client.post(
            "/api/v1/auth/signup", json={"name": "Test", "email": email, "password": PASSWORD}
        )
        assert r.status_code == 201, r.text
        engine = client.app.state.service.store.engine  # type: ignore[attr-defined]
        if confirmed:
            confirm_email(engine, email)
        with engine.connect() as conn:
            return conn.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email}).one()[
                0
            ]

    return make


@pytest.fixture
def make_user(sign_up):
    """`make_user(started_client, email=..., confirmed=True)`: another user of the same app, as a
    new https client with its own cookie jar. Does not restart the app, so it can be used next to
    a client that is already inside `with`."""

    def make(started: TestClient, email: str, confirmed: bool = True) -> UserClient:
        c = UserClient(started.app, base_url="https://testserver")
        c.email = email
        c.user_id = sign_up(c, email, confirmed)
        return c

    return make


@pytest.fixture
def seed_user():
    """`seed_user(database_url, email=...)`: a confirmed user row for service-level tests that
    have no app. Returns the user id (the same id if the email already exists)."""

    def make(url: str, email: str = "owner@example.com") -> str:
        engine = create_engine(url, poolclass=NullPool)
        try:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO users (id, name, email, password_hash, email_verified_at, "
                        "created_at) VALUES (:id, 'Test', :e, 'x', now(), now()) "
                        "ON CONFLICT (email) DO NOTHING"
                    ),
                    {"id": uuid.uuid4().hex, "e": email},
                )
                return conn.execute(
                    text("SELECT id FROM users WHERE email = :e"), {"e": email}
                ).one()[0]
        finally:
            engine.dispose()

    return make
