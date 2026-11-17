"""The script library's database work (T-504; R-43, R-50, R-12).

Every query is scoped to `user_id`, so another user's script cannot be found at all (R-12).
Script text is never logged.

For T-505 (job creation): call `save_or_touch(conn, user_id, language, text)` inside the same
transaction that creates the job. It never commits; it returns the script's id. The same text in
the same language is one live row whose `last_used_at` moves forward; another language is a
separate row; a deleted script's text is saved again as a new live row."""

import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import Connection, Engine, func, select, text, update

from .models import Script


@dataclass(frozen=True)
class ScriptRow:
    id: str
    language: str
    text: str
    created_at: datetime
    last_used_at: datetime


def _now() -> datetime:
    return datetime.now(timezone.utc)


def text_hash(script: str) -> str:
    return hashlib.sha256(script.encode("utf-8")).hexdigest()


def save_or_touch(conn: Connection, user_id: str, language: str, script: str) -> str:
    """Save a script the user just used, or move an identical live one to the top of the library.

    One INSERT ... ON CONFLICT on the partial unique index, so two requests with the same text
    at the same moment still make exactly one row. The caller owns the transaction."""
    now = _now()
    row = conn.execute(
        text(
            "INSERT INTO scripts (id, user_id, language, text, text_hash, created_at, "
            "last_used_at) VALUES (:id, :user_id, :language, :text, :hash, :now, :now) "
            "ON CONFLICT (user_id, language, text_hash) WHERE deleted_at IS NULL "
            "DO UPDATE SET last_used_at = EXCLUDED.last_used_at RETURNING id"
        ),
        {
            "id": uuid.uuid4().hex,
            "user_id": user_id,
            "language": language,
            "text": script,
            "hash": text_hash(script),
            "now": now,
        },
    ).one()
    return str(row.id)


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


_COLUMNS = (Script.id, Script.language, Script.text, Script.created_at, Script.last_used_at)


def list_scripts(
    engine: Engine,
    user_id: str,
    page: int,
    page_size: int,
    q: str | None,
    language: str | None,
) -> tuple[list[ScriptRow], int]:
    """The user's live scripts, most recently used first (R-43). `q` is a case-insensitive
    substring match with LIKE wildcards taken literally; `language` is an exact match."""
    where = [Script.user_id == user_id, Script.deleted_at.is_(None)]
    if q:
        where.append(Script.text.ilike(f"%{_escape_like(q)}%", escape="\\"))
    if language:
        where.append(Script.language == language)
    with engine.connect() as conn:
        total = conn.execute(select(func.count()).select_from(Script).where(*where)).scalar_one()
        rows = conn.execute(
            select(*_COLUMNS)
            .where(*where)
            .order_by(Script.last_used_at.desc(), Script.id)
            .limit(page_size)
            .offset((page - 1) * page_size)
        ).all()
    return [ScriptRow(*r) for r in rows], int(total)


def get_script(engine: Engine, user_id: str, script_id: str) -> ScriptRow | None:
    """One live script of this user, or None (missing, deleted or someone else's: R-12)."""
    with engine.connect() as conn:
        r = conn.execute(
            select(*_COLUMNS).where(
                Script.id == script_id, Script.user_id == user_id, Script.deleted_at.is_(None)
            )
        ).first()
    return ScriptRow(*r) if r else None


def delete_script(engine: Engine, user_id: str, script_id: str) -> bool:
    """Soft delete (R-50). False when there is no live script of this user's with that id."""
    with engine.begin() as conn:
        result = conn.execute(
            update(Script)
            .where(Script.id == script_id, Script.user_id == user_id, Script.deleted_at.is_(None))
            .values(deleted_at=_now())
        )
    return result.rowcount == 1
