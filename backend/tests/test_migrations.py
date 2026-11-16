"""T-102: `alembic upgrade head` builds the jobs table from nothing, and downgrade removes it.

Runs against the Docker database (`docker compose up -d db`) inside a throwaway schema
from the shared `empty_schema` fixture. Free: it never reaches fal.ai or any paid service."""

from alembic import command
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import NullPool

EXPECTED_COLUMNS = {
    "id",
    "user_id",
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
    assert len(columns) == 14
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


def test_0003_keeps_a_job_made_before_accounts_with_no_owner(empty_schema):
    """T-204 (R-12): upgrading 0002 -> 0003 keeps an existing job, owner NULL; deleting a user
    keeps their jobs as ownerless; downgrade removes the column again."""
    cfg = empty_schema.alembic_config()
    command.upgrade(cfg, "0002")
    engine = create_engine(empty_schema.url, poolclass=NullPool)
    job = (
        "INSERT INTO jobs (id, status, language, script, image_file, created_at, updated_at) "
        "VALUES (:id, 'completed', 'English', 'hi', 'image.png', now(), now())"
    )
    try:
        with engine.begin() as conn:
            conn.execute(text(job), {"id": "old"})
        command.upgrade(cfg, "0003")
        with engine.begin() as conn:
            assert conn.execute(text("SELECT user_id FROM jobs WHERE id = 'old'")).one()[0] is None
            conn.execute(
                text(
                    "INSERT INTO users (id, name, email, password_hash, created_at) "
                    "VALUES ('u1', 'A', 'a@example.com', 'x', now())"
                )
            )
            conn.execute(text(job), {"id": "new"})
            conn.execute(text("UPDATE jobs SET user_id = 'u1' WHERE id = 'new'"))
            conn.execute(text("DELETE FROM users WHERE id = 'u1'"))
            assert conn.execute(text("SELECT user_id FROM jobs WHERE id = 'new'")).one()[0] is None
        assert any(i["column_names"] == ["user_id"] for i in inspect(engine).get_indexes("jobs"))
        command.downgrade(cfg, "0002")
        assert "user_id" not in {c["name"] for c in inspect(engine).get_columns("jobs")}
    finally:
        engine.dispose()
