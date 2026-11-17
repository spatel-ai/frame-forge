"""T-102: `alembic upgrade head` builds the jobs table from nothing, and downgrade removes it.

Runs against the Docker database (`docker compose up -d db`) inside a throwaway schema
from the shared `empty_schema` fixture. Free: it never reaches fal.ai or any paid service."""

import re
from typing import get_args

from alembic import command
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import NullPool

from app.wallet.schemas import LedgerKind

EXPECTED_COLUMNS = {
    "id",
    "consent_version",
    "consent_at",
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
    "price_credits",
    "approve_attempt",
    "needs_review",
}


def test_upgrade_and_downgrade_in_throwaway_schema(empty_schema, admin_engine):
    schema = empty_schema.name
    cfg = empty_schema.alembic_config()

    command.upgrade(cfg, "head")
    insp = inspect(admin_engine)
    assert insp.has_table("jobs", schema=schema)
    columns = insp.get_columns("jobs", schema=schema)
    assert {c["name"] for c in columns} == EXPECTED_COLUMNS
    assert len(columns) == 19
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


def test_head_builds_the_wallet_tables(empty_schema, admin_engine):
    """T-301 (R-04): upgrade head creates wallets and ledger_entries with the CHECK that forbids
    a negative available balance, UNIQUE (kind, ref_type, ref_id), the kind CHECK listing exactly
    the contract's LedgerKind, and the per-user index; downgrade to 0003 removes them."""
    cfg = empty_schema.alembic_config()
    schema = empty_schema.name
    command.upgrade(cfg, "head")
    insp = inspect(admin_engine)
    assert insp.has_table("wallets", schema=schema)
    assert insp.has_table("ledger_entries", schema=schema)
    checks = {c["name"]: c["sqltext"] for c in insp.get_check_constraints("wallets", schema=schema)}
    assert "ck_wallets_available_not_negative" in checks
    uniques = insp.get_unique_constraints("ledger_entries", schema=schema)
    assert {
        "name": "uq_ledger_entries_kind_ref",
        "column_names": ["kind", "ref_type", "ref_id"],
    } in [{"name": u["name"], "column_names": u["column_names"]} for u in uniques]
    kinds_sql = {
        c["name"]: c["sqltext"] for c in insp.get_check_constraints("ledger_entries", schema=schema)
    }["ck_ledger_entries_kind"]
    assert set(re.findall(r"'(\w+)'", kinds_sql)) == set(get_args(LedgerKind))
    assert "ix_ledger_entries_user_created" in {
        i["name"] for i in insp.get_indexes("ledger_entries", schema=schema)
    }
    assert {c["name"] for c in insp.get_columns("ledger_entries", schema=schema)} == {
        "id",
        "user_id",
        "kind",
        "credits",
        "reserved_delta",
        "balance_after",
        "reserved_after",
        "ref_type",
        "ref_id",
        "created_by",
        "created_at",
    }
    command.downgrade(cfg, "0003")
    insp = inspect(admin_engine)
    assert not insp.has_table("wallets", schema=schema)
    assert not insp.has_table("ledger_entries", schema=schema)


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


def test_0005_adds_the_charging_columns_with_safe_defaults(empty_schema):
    """T-303, T-304 (R-09, R-10): 0005 adds price_credits (NULL), approve_attempt (0) and
    needs_review (false) to jobs, keeping existing rows; downgrade to 0004 removes them."""
    cfg = empty_schema.alembic_config()
    command.upgrade(cfg, "0004")
    engine = create_engine(empty_schema.url, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO jobs (id, status, language, script, image_file, created_at, "
                    "updated_at) VALUES ('old', 'audio_ready', 'English', 'hi', 'image.png', "
                    "now(), now())"
                )
            )
        command.upgrade(cfg, "0005")
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT price_credits, approve_attempt, needs_review FROM jobs")
            ).one()
        assert tuple(row) == (None, 0, False)
        types = {c["name"]: str(c["type"]) for c in inspect(engine).get_columns("jobs")}
        assert (types["price_credits"], types["approve_attempt"]) == ("INTEGER", "INTEGER")
        assert types["needs_review"] == "BOOLEAN"
        command.downgrade(cfg, "0004")
        names = {c["name"] for c in inspect(engine).get_columns("jobs")}
        assert not names & {"price_credits", "approve_attempt", "needs_review"}
    finally:
        engine.dispose()


def test_0006_builds_the_payment_tables(empty_schema, admin_engine):
    """T-402 (R-02, R-03): 0006 creates payment_orders (UNIQUE Razorpay order and payment ids,
    status and amount CHECKs) and webhook_events (event id key); the database refuses an order
    whose total is not price + fee + GST, and a paid order with no payment; downgrade to 0005
    removes both tables."""
    cfg = empty_schema.alembic_config()
    schema = empty_schema.name
    command.upgrade(cfg, "head")
    insp = inspect(admin_engine)
    uniques = {
        u["name"]: u["column_names"] for u in insp.get_unique_constraints("payment_orders", schema)
    }
    assert uniques["uq_payment_orders_razorpay_order_id"] == ["razorpay_order_id"]
    assert uniques["uq_payment_orders_razorpay_payment_id"] == ["razorpay_payment_id"]
    checks = {c["name"] for c in insp.get_check_constraints("payment_orders", schema=schema)}
    assert {
        "ck_payment_orders_status",
        "ck_payment_orders_positive",
        "ck_payment_orders_amount_parts",
        "ck_payment_orders_paid_has_payment",
    } <= checks
    assert insp.get_pk_constraint("webhook_events", schema=schema)["constrained_columns"] == [
        "event_id"
    ]

    engine = create_engine(empty_schema.url, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO users (id, name, email, password_hash, created_at) "
                    "VALUES ('u1', 'T', 't@example.com', 'x', now())"
                )
            )
        insert = (
            "INSERT INTO payment_orders (id, user_id, razorpay_order_id, amount_paise, "
            "price_paise, fee_paise, fee_gst_paise, credits, status, created_at, updated_at) "
            "VALUES (:id, 'u1', :rid, :amount, 100000, 2000, 0, 1000, :status, now(), now())"
        )
        for bad in ({"amount": 100000, "status": "created"}, {"amount": 102000, "status": "paid"}):
            try:
                with engine.begin() as conn:
                    conn.execute(text(insert), {"id": "o1", "rid": "r1", **bad})
            except Exception as exc:  # IntegrityError from the CHECK
                assert "ck_payment_orders" in str(exc)
            else:
                raise AssertionError(f"accepted {bad}")
        with engine.begin() as conn:
            conn.execute(
                text(insert), {"id": "o2", "rid": "r2", "amount": 102000, "status": "created"}
            )
    finally:
        engine.dispose()

    command.downgrade(cfg, "0005")
    insp = inspect(admin_engine)
    assert not insp.has_table("payment_orders", schema=schema)
    assert not insp.has_table("webhook_events", schema=schema)


def test_0007_builds_the_scripts_table(empty_schema, admin_engine):
    """T-504 (R-43, R-50): 0007 creates scripts with a partial UNIQUE index on live rows
    (user, language, text hash) and a recency index; the database refuses a second live row with
    the same text but allows one once the first is deleted; downgrade to 0006 removes the table."""
    cfg = empty_schema.alembic_config()
    schema = empty_schema.name
    command.upgrade(cfg, "head")
    insp = inspect(admin_engine)
    indexes = {i["name"]: i for i in insp.get_indexes("scripts", schema)}
    live = indexes["uq_scripts_live_text"]
    assert live["unique"] and live["column_names"] == ["user_id", "language", "text_hash"]
    assert "deleted_at IS NULL" in live["dialect_options"]["postgresql_where"]
    assert "ix_scripts_user_last_used" in indexes

    engine = create_engine(empty_schema.url, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO users (id, name, email, password_hash, created_at) "
                    "VALUES ('u1', 'T', 't@example.com', 'x', now())"
                )
            )
        insert = (
            "INSERT INTO scripts (id, user_id, language, text, text_hash, created_at, "
            "last_used_at) VALUES (:id, 'u1', 'English', 'hi', 'h1', now(), now())"
        )
        with engine.begin() as conn:
            conn.execute(text(insert), {"id": "s1"})
        try:
            with engine.begin() as conn:
                conn.execute(text(insert), {"id": "s2"})
        except Exception as exc:
            assert "uq_scripts_live_text" in str(exc)
        else:
            raise AssertionError("accepted a second live row with the same text")
        with engine.begin() as conn:
            conn.execute(text("UPDATE scripts SET deleted_at = now() WHERE id = 's1'"))
            conn.execute(text(insert), {"id": "s3"})
    finally:
        engine.dispose()

    command.downgrade(cfg, "0006")
    assert not inspect(admin_engine).has_table("scripts", schema=schema)


def test_0008_adds_the_nullable_consent_columns(empty_schema):
    """T-502 (R-14, D-045): 0008 adds consent_version (text) and consent_at (timestamptz) to jobs,
    both NULL for existing rows; downgrade to 0007 removes them."""
    cfg = empty_schema.alembic_config()
    command.upgrade(cfg, "0007")
    engine = create_engine(empty_schema.url, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO jobs (id, status, language, script, image_file, created_at, "
                    "updated_at) VALUES ('old', 'audio_ready', 'English', 'hi', 'image.png', "
                    "now(), now())"
                )
            )
        command.upgrade(cfg, "0008")
        with engine.begin() as conn:
            row = conn.execute(text("SELECT consent_version, consent_at FROM jobs")).one()
        assert tuple(row) == (None, None)
        cols = {c["name"]: c for c in inspect(engine).get_columns("jobs")}
        assert str(cols["consent_version"]["type"]) == "TEXT"
        assert "TIMESTAMP" in str(cols["consent_at"]["type"]) and cols["consent_at"]["nullable"]
        command.downgrade(cfg, "0007")
        names = {c["name"] for c in inspect(engine).get_columns("jobs")}
        assert not names & {"consent_version", "consent_at"}
    finally:
        engine.dispose()
