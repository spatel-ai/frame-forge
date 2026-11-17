"""PostgreSQL job store. Status transitions are compare-and-set so that a job can
only move forward once, which is what prevents duplicate paid submissions.

Every method returns plain dicts. Timestamp columns are `timestamptz` in the
database but are handed to callers as `now_iso()` text, as they were on SQLite,
so the job service and the HTTP layer see the same contract."""

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Connection, Row, func, insert, select, update

from ..core.database import make_engine
from .models import Job

AUDIO_GENERATING = "audio_generating"
AUDIO_READY = "audio_ready"
VIDEO_SUBMITTING = "video_submitting"
VIDEO_GENERATING = "video_generating"
# D-019, D-066: the paid AI video has arrived; banners are being added and the video stored. Free
# and safe to retry. The hold stays until `completed`.
VIDEO_ASSEMBLING = "video_assembling"
COMPLETED = "completed"
FAILED = "failed"
# Statuses behind the list filter "in_progress" (T-501).
IN_PROGRESS = (
    AUDIO_GENERATING,
    AUDIO_READY,
    VIDEO_SUBMITTING,
    VIDEO_GENERATING,
    VIDEO_ASSEMBLING,
)

_jobs = Job.__table__
# For relative updates in `transition`, e.g. `approve_attempt=jobs.c.approve_attempt + 1`.
jobs = _jobs
# A wallet step run inside a job's status-change transaction (HLD §5.2, backend rule 3). It must
# not commit; raising rolls the status change back too.
LedgerStep = Callable[[Connection], object]
# Columns `transition` may set. `id` is the row's identity and is never rewritten.
_SETTABLE = frozenset(_jobs.c.keys()) - {"id"}
_TIMESTAMPS = frozenset(c.name for c in _jobs.c if c.name.endswith("_at"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _to_db(name: str, value: Any) -> Any:
    if name in _TIMESTAMPS and isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


def read_job(conn: Connection, job_id: str) -> dict:
    """The job's row as seen on `conn`, inside the caller's transaction (so after an UPDATE on
    the same connection, it shows the new values)."""
    return _to_dict(conn.execute(select(_jobs).where(_jobs.c.id == job_id)).one())


def _to_dict(row: Row) -> dict:
    job = dict(row._mapping)
    for name in _TIMESTAMPS:
        value = job[name]
        if value is not None:
            job[name] = value.astimezone(timezone.utc).isoformat(timespec="seconds")
    return job


class JobStore:
    def __init__(self, database_url: str):
        self.engine = make_engine(database_url)

    def close(self) -> None:
        """Close every pooled connection. Safe to call more than once."""
        self.engine.dispose()

    def create(
        self,
        job_id: str,
        user_id: str,
        language: str,
        script: str,
        image_file: str,
        ledger: LedgerStep | None = None,
        consent_version: str | None = None,
        save_script: Callable[[Connection], str] | None = None,
    ) -> dict:
        """Insert the job in `audio_generating`, recording the consent version and the time
        (R-14, D-045). The service always passes it; only fixtures for old jobs omit it.
        `ledger`, if given, runs in the same transaction after the insert; if it raises, no
        job row is written and the exception propagates.
        `save_script`, if given, runs first in the same transaction and returns the library
        script's id, stored in `jobs.script_id` (T-505, R-43, R-51); it never commits, and a
        later failure (such as the voice charge) rolls the script save back too."""
        ts = _to_db("created_at", now_iso())
        with self.engine.begin() as conn:
            script_id = save_script(conn) if save_script is not None else None
            conn.execute(
                insert(_jobs).values(  # type: ignore[arg-type]  # Table typed as FromClause
                    id=job_id,
                    user_id=user_id,
                    status=AUDIO_GENERATING,
                    language=language,
                    script=script,
                    image_file=image_file,
                    consent_version=consent_version,
                    script_id=script_id,
                    consent_at=ts if consent_version is not None else None,
                    created_at=ts,
                    updated_at=ts,
                )
            )
            if ledger is not None:
                ledger(conn)
        return self.get(job_id)  # type: ignore[return-value]

    def get(self, job_id: str) -> dict | None:
        """Any job, whoever owns it. For the poller and internal use; routes use `get_owned`."""
        with self.engine.connect() as conn:
            row = conn.execute(select(_jobs).where(_jobs.c.id == job_id)).first()
        return _to_dict(row) if row else None

    def get_owned(self, job_id: str, user_id: str) -> dict | None:
        """The job only if `user_id` owns it. A job with no owner never matches."""
        with self.engine.connect() as conn:
            row = conn.execute(
                select(_jobs).where(_jobs.c.id == job_id, _jobs.c.user_id == user_id)
            ).first()
        return _to_dict(row) if row else None

    def list_owned(
        self,
        user_id: str,
        page: int = 1,
        page_size: int = 20,
        statuses: tuple[str, ...] | None = None,
        q: str | None = None,
    ) -> tuple[list[dict], int]:
        """One page (1-based) of the user's jobs, newest first, and the count that matches the
        filters. `statuses` limits by status; `q` is a case-insensitive substring of the script,
        with `%` and `_` taken literally. Jobs with no owner never match."""
        if page < 1 or page_size < 1:
            raise ValueError("page and page_size must be at least 1")
        where = [_jobs.c.user_id == user_id]
        if statuses is not None:
            where.append(_jobs.c.status.in_(statuses))
        if q:
            where.append(_jobs.c.script.icontains(q, autoescape=True))
        with self.engine.connect() as conn:
            total = conn.execute(select(func.count()).select_from(_jobs).where(*where)).scalar_one()
            rows = conn.execute(
                select(_jobs)
                .where(*where)
                .order_by(_jobs.c.created_at.desc(), _jobs.c.id.desc())
                .limit(page_size)
                .offset((page - 1) * page_size)
            ).all()
        return [_to_dict(r) for r in rows], total

    def list_by_status(self, status: str) -> list[dict]:
        with self.engine.connect() as conn:
            rows = conn.execute(
                select(_jobs).where(_jobs.c.status == status).order_by(_jobs.c.created_at)
            ).all()
        return [_to_dict(r) for r in rows]

    def transition(
        self,
        job_id: str,
        from_status: str,
        to_status: str,
        ledger: LedgerStep | None = None,
        **fields: Any,
    ) -> bool:
        """Move a job from one status to another and set extra columns.
        Returns False, changing nothing, if the job is not in `from_status`.

        This is one `UPDATE ... WHERE id = ? AND status = ?`. Under PostgreSQL's
        READ COMMITTED, a concurrent caller blocks on the row lock and then
        re-checks the WHERE clause against the committed row, so only one caller
        can match a given `from_status`.

        `ledger`, if given, is the status change's wallet step (HLD §5.2). It runs in the SAME
        transaction, only after the UPDATE matched exactly one row, so the status and the ledger
        entry commit together or not at all (backend rule 3). If the UPDATE matched no row it is
        never called. If it raises, everything rolls back and the exception propagates."""
        unknown = set(fields) - _SETTABLE
        if unknown:
            raise ValueError(f"Not a settable jobs column: {', '.join(sorted(unknown))}")
        values = {**fields, "status": to_status, "updated_at": now_iso()}
        values = {name: _to_db(name, value) for name, value in values.items()}
        with self.engine.begin() as conn:
            result = conn.execute(
                # Job.__table__ is typed as FromClause; update() wants a Table. Same at insert().
                update(_jobs)  # type: ignore[arg-type]
                .where(_jobs.c.id == job_id, _jobs.c.status == from_status)
                .values(**values)
            )
            matched = result.rowcount == 1
            if matched and ledger is not None:
                ledger(conn)
        return matched
