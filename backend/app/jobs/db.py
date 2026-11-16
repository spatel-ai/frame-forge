"""SQLite job store. Status transitions are compare-and-set so that a job can
only move forward once, which is what prevents duplicate paid submissions."""

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

AUDIO_GENERATING = "audio_generating"
AUDIO_READY = "audio_ready"
VIDEO_SUBMITTING = "video_submitting"
VIDEO_GENERATING = "video_generating"
COMPLETED = "completed"
FAILED = "failed"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    language TEXT NOT NULL,
    script TEXT NOT NULL,
    image_file TEXT NOT NULL,
    audio_file TEXT,
    audio_duration_seconds REAL,
    video_file TEXT,
    provider_request_id TEXT,
    video_started_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class JobStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute(_SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def create(self, job_id: str, language: str, script: str, image_file: str) -> dict:
        ts = now_iso()
        with self._lock:
            self._conn.execute(
                "INSERT INTO jobs (id, status, language, script, image_file, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (job_id, AUDIO_GENERATING, language, script, image_file, ts, ts),
            )
        return self.get(job_id)  # type: ignore[return-value]

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return dict(row) if row else None

    def list_by_status(self, status: str) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM jobs WHERE status = ? ORDER BY created_at", (status,)
            ).fetchall()
        return [dict(r) for r in rows]

    def transition(self, job_id: str, from_status: str, to_status: str, **fields: Any) -> bool:
        """Move a job from one status to another and set extra columns.
        Returns False, changing nothing, if the job is not in `from_status`."""
        fields = {**fields, "status": to_status, "updated_at": now_iso()}
        assignments = ", ".join(f"{name} = ?" for name in fields)
        with self._lock:
            cur = self._conn.execute(
                f"UPDATE jobs SET {assignments} WHERE id = ? AND status = ?",
                (*fields.values(), job_id, from_status),
            )
        return cur.rowcount == 1
