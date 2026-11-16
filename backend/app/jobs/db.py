"""PostgreSQL job store. Status transitions are compare-and-set so that a job can
only move forward once, which is what prevents duplicate paid submissions.

Every method returns plain dicts. Timestamp columns are `timestamptz` in the
database but are handed to callers as `now_iso()` text, as they were on SQLite,
so the job service and the HTTP layer see the same contract."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Row, insert, select, update

from ..core.database import make_engine
from .models import Job

AUDIO_GENERATING = "audio_generating"
AUDIO_READY = "audio_ready"
VIDEO_SUBMITTING = "video_submitting"
VIDEO_GENERATING = "video_generating"
COMPLETED = "completed"
FAILED = "failed"

_jobs = Job.__table__
# Columns `transition` may set. `id` is the row's identity and is never rewritten.
_SETTABLE = frozenset(_jobs.c.keys()) - {"id"}
_TIMESTAMPS = frozenset(c.name for c in _jobs.c if c.name.endswith("_at"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _to_db(name: str, value: Any) -> Any:
    if name in _TIMESTAMPS and isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


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

    def create(self, job_id: str, language: str, script: str, image_file: str) -> dict:
        ts = _to_db("created_at", now_iso())
        with self.engine.begin() as conn:
            conn.execute(
                insert(_jobs).values(
                    id=job_id,
                    status=AUDIO_GENERATING,
                    language=language,
                    script=script,
                    image_file=image_file,
                    created_at=ts,
                    updated_at=ts,
                )
            )
        return self.get(job_id)  # type: ignore[return-value]

    def get(self, job_id: str) -> dict | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(_jobs).where(_jobs.c.id == job_id)).first()
        return _to_dict(row) if row else None

    def list_by_status(self, status: str) -> list[dict]:
        with self.engine.connect() as conn:
            rows = conn.execute(
                select(_jobs).where(_jobs.c.status == status).order_by(_jobs.c.created_at)
            ).all()
        return [_to_dict(r) for r in rows]

    def transition(self, job_id: str, from_status: str, to_status: str, **fields: Any) -> bool:
        """Move a job from one status to another and set extra columns.
        Returns False, changing nothing, if the job is not in `from_status`.

        This is one `UPDATE ... WHERE id = ? AND status = ?`. Under PostgreSQL's
        READ COMMITTED, a concurrent caller blocks on the row lock and then
        re-checks the WHERE clause against the committed row, so only one caller
        can match a given `from_status`."""
        unknown = set(fields) - _SETTABLE
        if unknown:
            raise ValueError(f"Not a settable jobs column: {', '.join(sorted(unknown))}")
        values = {**fields, "status": to_status, "updated_at": now_iso()}
        values = {name: _to_db(name, value) for name, value in values.items()}
        with self.engine.begin() as conn:
            result = conn.execute(
                update(_jobs)
                .where(_jobs.c.id == job_id, _jobs.c.status == from_status)
                .values(**values)
            )
        return result.rowcount == 1
