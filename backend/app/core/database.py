"""Database engine construction (synchronous SQLAlchemy, decision D-023)."""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """The one declarative base: every feature's models register their tables on it, so Alembic
    sees them all."""


class DatabaseNotReady(RuntimeError):
    """The database cannot be used yet; the message says what to run."""


def make_engine(url: str) -> Engine:
    # connect_timeout (libpq, seconds) makes an unreachable host fail fast instead of hanging.
    return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 5})


ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


def latest_revision() -> str | None:
    """The newest migration in the code (Alembic head)."""
    return ScriptDirectory.from_config(Config(str(ALEMBIC_INI))).get_current_head()


def check_database(engine: Engine) -> None:
    """Fail fast at start-up if the database is unreachable or not migrated to the newest
    migration in the code. Never runs migrations itself."""
    where = engine.url.render_as_string(hide_password=True)
    behind = (
        f"The database at {where} is not up to date. Run `uv run alembic upgrade head` "
        "in backend/, then try again."
    )
    try:
        with engine.connect() as conn:
            current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except OperationalError:
        raise DatabaseNotReady(
            f"Cannot reach the database at {where}. Start it from the repo root with "
            "`docker compose up -d db`, then try again."
        ) from None
    except ProgrammingError:  # no alembic_version table: never migrated
        raise DatabaseNotReady(behind) from None
    if current != latest_revision():
        raise DatabaseNotReady(behind)
