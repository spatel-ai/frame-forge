"""Database engine construction (synchronous SQLAlchemy, decision D-023)."""

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import OperationalError


class DatabaseNotReady(RuntimeError):
    """The database cannot be used yet; the message says what to run."""


def make_engine(url: str) -> Engine:
    # connect_timeout (libpq, seconds) makes an unreachable host fail fast instead of hanging.
    return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 5})


def check_database(engine: Engine) -> None:
    """Fail fast at start-up if the database is unreachable or not migrated.
    Never runs migrations itself."""
    where = engine.url.render_as_string(hide_password=True)
    try:
        with engine.connect() as conn:
            found = conn.execute(text("SELECT to_regclass('jobs')")).scalar()
    except OperationalError:
        raise DatabaseNotReady(
            f"Cannot reach the database at {where}. Start it from the repo root with "
            "`docker compose up -d db`, then try again."
        ) from None
    if found is None:
        raise DatabaseNotReady(
            f"The database at {where} has no jobs table. Run `uv run alembic upgrade head` "
            "in backend/, then try again."
        )
