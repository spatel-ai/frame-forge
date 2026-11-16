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
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import NullPool

from app.core.config import Settings

BACKEND_DIR = Path(__file__).resolve().parent.parent
SCHEMA_PREFIX = "test_t_"


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
