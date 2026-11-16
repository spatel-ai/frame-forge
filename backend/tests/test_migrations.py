"""T-102: `alembic upgrade head` builds the jobs table from nothing, and downgrade removes it.

Runs against the Docker database (`docker compose up -d db`) inside a throwaway schema.
Free: it never reaches fal.ai or any paid service."""

import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError

from app.core.config import Settings
from app.core.database import make_engine

BACKEND_DIR = Path(__file__).resolve().parent.parent

EXPECTED_COLUMNS = {
    "id", "status", "language", "script", "image_file", "audio_file", "video_file",
    "provider_request_id", "error", "audio_duration_seconds", "video_started_at",
    "created_at", "updated_at",
}


def test_upgrade_and_downgrade_in_throwaway_schema():
    engine = make_engine(Settings().database_url)
    schema = f"test_mig_{uuid.uuid4().hex[:12]}"
    try:
        try:
            with engine.begin() as conn:
                conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        except OperationalError as exc:
            pytest.fail(
                "PostgreSQL is unreachable. Run `docker compose up -d db` from the repo root "
                f"and try again. ({type(exc).__name__})"
            )

        # Point migrations at the throwaway schema through the connection's search_path.
        scoped = engine.url.update_query_dict({"options": f"-csearch_path={schema}"})
        cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        cfg.set_main_option(
            "sqlalchemy.url", scoped.render_as_string(hide_password=False).replace("%", "%%")
        )
        cfg.attributes["configure_logger"] = False

        command.upgrade(cfg, "head")
        insp = inspect(engine)
        assert insp.has_table("jobs", schema=schema)
        columns = insp.get_columns("jobs", schema=schema)
        assert {c["name"] for c in columns} == EXPECTED_COLUMNS
        assert len(columns) == 13
        assert insp.get_pk_constraint("jobs", schema=schema)["constrained_columns"] == ["id"]
        assert any(i["column_names"] == ["status"] for i in insp.get_indexes("jobs", schema=schema))

        command.downgrade(cfg, "base")
        assert not inspect(engine).has_table("jobs", schema=schema)
    finally:
        try:
            with engine.begin() as conn:
                conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        except OperationalError:
            pass
        engine.dispose()
