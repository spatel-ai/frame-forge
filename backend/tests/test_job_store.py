"""T-103: the PostgreSQL job store keeps the compare-and-set guarantee and the dict contract.

Each test runs in its own migrated schema (tests/conftest.py). Free: no provider is used."""

import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from app.jobs import db
from app.jobs.db import JobStore

ISO_SECONDS_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$")


@pytest.fixture
def store(database_url):
    s = JobStore(database_url)
    yield s
    s.close()


@pytest.fixture
def owner(database_url, seed_user):
    return seed_user(database_url)


def with_options(url: str, **query: str) -> str:
    """The same URL with extra libpq settings appended to its `options`."""
    u = make_url(url)
    extra = " ".join(f"-c{k}={v}" for k, v in query.items())
    options = f"{u.query.get('options', '')} {extra}".strip()
    return u.update_query_dict({"options": options}).render_as_string(hide_password=False)


def ready_job(store: JobStore, owner: str) -> str:
    job_id = uuid.uuid4().hex
    store.create(job_id, owner, "English", "hi", "image.png")
    assert store.transition(job_id, db.AUDIO_GENERATING, db.AUDIO_READY, audio_file="a.wav")
    return job_id


def test_concurrent_transitions_on_one_job_let_exactly_one_win(database_url, owner):
    """R-56: many simultaneous approvals of one job, each on its own connection,
    move it to video_submitting exactly once.

    To make the race real rather than lucky, a separate transaction first locks the
    row; every thread's UPDATE is then sent and seen waiting on that lock in
    pg_stat_activity before the lock is released, so all of them contend at once."""
    threads_n = 12
    app_name = f"t103_race_{uuid.uuid4().hex[:8]}"
    store = JobStore(with_options(database_url, application_name=app_name))
    locker = create_engine(database_url, poolclass=NullPool)
    try:
        job_id = ready_job(store, owner)
        with store.engine.connect() as conn:
            # The server default; the guarantee is shown under it, not under a stricter level.
            assert conn.get_isolation_level() == "READ COMMITTED"

        results: list[bool] = []
        errors: list[BaseException] = []
        barrier = threading.Barrier(threads_n)

        def approve():
            try:
                barrier.wait()
                ok = store.transition(job_id, db.AUDIO_READY, db.VIDEO_SUBMITTING, error=None)
                results.append(ok)
            except BaseException as exc:  # surfaced below
                errors.append(exc)

        # The monitor runs in autocommit: inside one transaction pg_stat_activity is a
        # frozen snapshot and would never show the waiters arriving.
        with (
            locker.connect() as lock_conn,
            locker.connect().execution_options(isolation_level="AUTOCOMMIT") as monitor,
        ):
            lock_conn.execute(text("SELECT 1 FROM jobs WHERE id = :id FOR UPDATE"), {"id": job_id})
            threads = [threading.Thread(target=approve) for _ in range(threads_n)]
            for t in threads:
                t.start()

            deadline = time.monotonic() + 15
            waiting = 0
            while time.monotonic() < deadline:
                waiting = monitor.execute(
                    text(
                        "SELECT count(*) FROM pg_stat_activity "
                        "WHERE application_name = :app AND wait_event_type = 'Lock'"
                    ),
                    {"app": app_name},
                ).scalar()
                if waiting == threads_n:
                    break
                time.sleep(0.01)
            assert waiting == threads_n, f"only {waiting} of {threads_n} updates were waiting"
            lock_conn.rollback()  # release the row lock; the waiting updates now race

        for t in threads:
            t.join(timeout=15)
        assert not errors, errors
        assert len(results) == threads_n
        assert results.count(True) == 1
        assert store.get(job_id)["status"] == db.VIDEO_SUBMITTING
    finally:
        store.close()
        locker.dispose()


def test_transition_refuses_unknown_fields_and_changes_nothing(store, owner):
    """R-56: only real columns can be set; a bad name never reaches SQL."""
    job_id = ready_job(store, owner)
    before = store.get(job_id)
    for bad in ({"no_such_column": 1}, {"status; DROP TABLE jobs": 1}, {"id": "other"}):
        with pytest.raises(ValueError, match="Not a settable jobs column"):
            store.transition(job_id, db.AUDIO_READY, db.VIDEO_SUBMITTING, **bad)
    assert store.get(job_id) == before


def test_transition_from_the_wrong_status_changes_nothing(store, owner):
    """R-56: compare-and-set returns False and leaves the row alone."""
    job_id = ready_job(store, owner)
    before = store.get(job_id)
    assert not store.transition(job_id, db.AUDIO_GENERATING, db.FAILED, error="x")
    assert not store.transition("missing", db.AUDIO_READY, db.VIDEO_SUBMITTING)
    assert store.get(job_id) == before


def test_timestamps_round_trip_as_now_iso_text(database_url, owner):
    """R-56: timestamptz columns come back in now_iso()'s exact format, even when the
    session's time zone is not UTC, and video_started_at round-trips unchanged."""
    store = JobStore(with_options(database_url, timezone="Asia/Kolkata"))
    try:
        job_id = uuid.uuid4().hex
        job = store.create(job_id, owner, "English", "hi", "image.png")
        assert ISO_SECONDS_UTC.match(job["created_at"]), job["created_at"]
        assert ISO_SECONDS_UTC.match(job["updated_at"]), job["updated_at"]
        assert job["video_started_at"] is None
        created = datetime.fromisoformat(job["created_at"])
        assert abs(datetime.now(timezone.utc) - created) < timedelta(seconds=5)

        started = "2026-11-17T08:30:15+00:00"
        assert store.transition(
            job_id, db.AUDIO_GENERATING, db.VIDEO_GENERATING, video_started_at=started
        )
        job = store.get(job_id)
        assert job["video_started_at"] == started
        assert datetime.fromisoformat(job["video_started_at"]).tzinfo is not None
        assert ISO_SECONDS_UTC.match(job["updated_at"])
        assert [j["id"] for j in store.list_by_status(db.VIDEO_GENERATING)] == [job_id]
        assert list(job) == [
            "id",
            "status",
            "language",
            "script",
            "image_file",
            "audio_file",
            "audio_duration_seconds",
            "video_file",
            "provider_request_id",
            "video_started_at",
            "error",
            "created_at",
            "updated_at",
            "user_id",
            "price_credits",  # 0005 (T-303, T-304)
            "approve_attempt",
            "needs_review",
            "consent_version",  # 0008 (T-502)
            "consent_at",
            "script_id",  # 0010 (T-505)
        ]
        assert (job["price_credits"], job["approve_attempt"], job["needs_review"]) == (
            None,
            0,
            False,
        )
    finally:
        store.close()


# ---- the ledger step runs in the status change's own transaction (T-304) -----------------


def test_ledger_step_commits_with_the_status(store, owner):
    """R-56, R-10: the ledger callable runs on the same connection, after the compare-and-set
    matched, and sees the new row; both commit together."""
    job_id = ready_job(store, owner)
    seen: list[dict] = []

    def step(conn):
        seen.append(db.read_job(conn, job_id))
        conn.execute(text("CREATE TABLE step_marker (id int)"))

    assert store.transition(
        job_id,
        db.AUDIO_READY,
        db.VIDEO_SUBMITTING,
        ledger=step,
        approve_attempt=db.jobs.c.approve_attempt + 1,
    )
    assert [(s["status"], s["approve_attempt"]) for s in seen] == [(db.VIDEO_SUBMITTING, 1)]
    with store.engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM step_marker")).scalar_one() == 0
    assert store.get(job_id)["approve_attempt"] == 1


def test_ledger_step_is_not_called_when_the_compare_and_set_misses(store, owner):
    """R-56: a transition that matches no row never runs its ledger step."""
    job_id = ready_job(store, owner)
    calls: list[object] = []
    assert not store.transition(job_id, db.VIDEO_GENERATING, db.COMPLETED, ledger=calls.append)
    assert not store.transition("missing", db.AUDIO_READY, db.FAILED, ledger=calls.append)
    assert calls == []


def test_ledger_step_failure_rolls_back_the_status(store, owner):
    """R-56, R-10: if the ledger step raises, the status change rolls back too and the
    exception reaches the caller."""
    job_id = ready_job(store, owner)
    before = store.get(job_id)

    def boom(conn):
        raise RuntimeError("ledger down")

    with pytest.raises(RuntimeError, match="ledger down"):
        store.transition(
            job_id,
            db.AUDIO_READY,
            db.VIDEO_SUBMITTING,
            ledger=boom,
            approve_attempt=db.jobs.c.approve_attempt + 1,
        )
    assert store.get(job_id) == before


def test_create_with_a_failing_ledger_step_writes_no_job(store, owner):
    """R-10: the job row and its voice charge are one transaction; a failing step leaves no
    row."""

    def boom(conn):
        raise RuntimeError("no credits")

    job_id = uuid.uuid4().hex
    with pytest.raises(RuntimeError):
        store.create(job_id, owner, "English", "hi", "image.png", ledger=boom)
    assert store.get(job_id) is None
