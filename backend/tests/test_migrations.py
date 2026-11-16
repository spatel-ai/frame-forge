"""T-102: `alembic upgrade head` builds the jobs table from nothing, and downgrade removes it.

Runs against the Docker database (`docker compose up -d db`) inside a throwaway schema
from the shared `empty_schema` fixture. Free: it never reaches fal.ai or any paid service."""

from alembic import command
from sqlalchemy import inspect

EXPECTED_COLUMNS = {
    "id",
    "status",
    "language",
    "script",
    "image_file",
    "audio_file",
    "video_file",
    "provider_request_id",
    "error",
    "audio_duration_seconds",
    "video_started_at",
    "created_at",
    "updated_at",
}


def test_upgrade_and_downgrade_in_throwaway_schema(empty_schema, admin_engine):
    schema = empty_schema.name
    cfg = empty_schema.alembic_config()

    command.upgrade(cfg, "head")
    insp = inspect(admin_engine)
    assert insp.has_table("jobs", schema=schema)
    columns = insp.get_columns("jobs", schema=schema)
    assert {c["name"] for c in columns} == EXPECTED_COLUMNS
    assert len(columns) == 13
    assert insp.get_pk_constraint("jobs", schema=schema)["constrained_columns"] == ["id"]
    assert any(i["column_names"] == ["status"] for i in insp.get_indexes("jobs", schema=schema))

    command.downgrade(cfg, "base")
    assert not inspect(admin_engine).has_table("jobs", schema=schema)


def test_head_builds_the_auth_tables(empty_schema, admin_engine):
    """T-201 (R-01): upgrade head creates users, sessions, email_tokens and audit_log."""
    command.upgrade(empty_schema.alembic_config(), "head")
    insp = inspect(admin_engine)
    for table in ("users", "sessions", "email_tokens", "audit_log"):
        assert insp.has_table(table, schema=empty_schema.name), table
    users = {c["name"] for c in insp.get_columns("users", schema=empty_schema.name)}
    assert users == {
        "id",
        "name",
        "email",
        "password_hash",
        "email_verified_at",
        "role",
        "status",
        "created_at",
    }
