"""PostgreSQL store for users, sessions, email tokens and the audit log.

Synchronous, like JobStore, and built on the engine the job store already owns. Methods return
plain dicts. Callers pass `now` so that time is controlled in one place (the service)."""

import uuid
from datetime import datetime

from sqlalchemy import Engine, Row, func, insert, select, update
from sqlalchemy.exc import IntegrityError

from .models import AuditLog, EmailToken, Session, User

_users = User.__table__
_sessions = Session.__table__
_tokens = EmailToken.__table__
_audit = AuditLog.__table__


class EmailTaken(Exception):
    """An account with this email already exists."""


def new_id() -> str:
    return uuid.uuid4().hex


def _row(row: Row | None) -> dict | None:
    return dict(row._mapping) if row else None


class AuthStore:
    def __init__(self, engine: Engine):
        self.engine = engine

    # users -----------------------------------------------------------------------------

    def create_account(
        self,
        *,
        name: str,
        email: str,
        password_hash: str,
        session_token_hash: str,
        session_expires_at: datetime,
        verify_token_hash: str,
        verify_expires_at: datetime,
        now: datetime,
    ) -> tuple[dict, str]:
        """Create the user, their first session, their confirmation token and the audit entry in
        one transaction. Returns (user, session id). Raises EmailTaken on a duplicate email."""
        user_id, session_id = new_id(), new_id()
        try:
            with self.engine.begin() as conn:
                conn.execute(
                    insert(_users).values(  # type: ignore[arg-type]
                        id=user_id,
                        name=name,
                        email=email,
                        password_hash=password_hash,
                        created_at=now,
                    )
                )
                conn.execute(
                    insert(_sessions).values(  # type: ignore[arg-type]
                        id=session_id,
                        user_id=user_id,
                        token_hash=session_token_hash,
                        created_at=now,
                        expires_at=session_expires_at,
                    )
                )
                conn.execute(
                    insert(_tokens).values(  # type: ignore[arg-type]
                        id=new_id(),
                        user_id=user_id,
                        purpose="verify",
                        token_hash=verify_token_hash,
                        created_at=now,
                        expires_at=verify_expires_at,
                    )
                )
                conn.execute(
                    insert(_audit).values(  # type: ignore[arg-type]
                        id=new_id(),
                        actor_user_id=user_id,
                        action="signup",
                        target=user_id,
                        created_at=now,
                    )
                )
        except IntegrityError as exc:
            if "uq_users_email" in str(exc.orig):
                raise EmailTaken from None
            raise
        return self.get_user(user_id), session_id  # type: ignore[return-value]

    def get_user(self, user_id: str) -> dict | None:
        with self.engine.connect() as conn:
            return _row(conn.execute(select(_users).where(_users.c.id == user_id)).first())

    def get_user_by_email(self, email: str) -> dict | None:
        with self.engine.connect() as conn:
            return _row(conn.execute(select(_users).where(_users.c.email == email)).first())

    def set_password_hash(self, user_id: str, password_hash: str) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                update(_users)  # type: ignore[arg-type]
                .where(_users.c.id == user_id)
                .values(password_hash=password_hash)
            )

    # sessions --------------------------------------------------------------------------

    def create_session(
        self, user_id: str, token_hash: str, now: datetime, expires_at: datetime
    ) -> str:
        session_id = new_id()
        with self.engine.begin() as conn:
            conn.execute(
                insert(_sessions).values(  # type: ignore[arg-type]
                    id=session_id,
                    user_id=user_id,
                    token_hash=token_hash,
                    created_at=now,
                    expires_at=expires_at,
                )
            )
        return session_id

    def find_active_session(self, token_hash: str, now: datetime) -> dict | None:
        """The session and its user, if the session is neither revoked nor expired and the user
        is active. Columns: session_id plus the user's columns."""
        stmt = (
            select(_sessions.c.id.label("session_id"), *_users.c)
            .join(_users, _users.c.id == _sessions.c.user_id)
            .where(
                _sessions.c.token_hash == token_hash,
                _sessions.c.revoked_at.is_(None),
                _sessions.c.expires_at > now,
                _users.c.status == "active",
            )
        )
        with self.engine.connect() as conn:
            return _row(conn.execute(stmt).first())

    def revoke_session(self, token_hash: str, now: datetime) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                update(_sessions)  # type: ignore[arg-type]
                .where(_sessions.c.token_hash == token_hash, _sessions.c.revoked_at.is_(None))
                .values(revoked_at=now)
            )

    def revoke_user_sessions(
        self, user_id: str, now: datetime, except_id: str | None = None
    ) -> int:
        stmt = update(_sessions).where(  # type: ignore[arg-type]
            _sessions.c.user_id == user_id, _sessions.c.revoked_at.is_(None)
        )
        if except_id is not None:
            stmt = stmt.where(_sessions.c.id != except_id)
        with self.engine.begin() as conn:
            return conn.execute(stmt.values(revoked_at=now)).rowcount

    def count_active_sessions(self, user_id: str, now: datetime) -> int:
        stmt = (
            select(func.count())
            .select_from(_sessions)
            .where(
                _sessions.c.user_id == user_id,
                _sessions.c.revoked_at.is_(None),
                _sessions.c.expires_at > now,
            )
        )
        with self.engine.connect() as conn:
            return conn.execute(stmt).scalar_one()

    # email tokens ----------------------------------------------------------------------

    def replace_email_token(
        self,
        user_id: str,
        purpose: str,
        token_hash: str,
        now: datetime,
        expires_at: datetime,
    ) -> None:
        """Store a new token and cancel the user's earlier unused tokens of the same purpose."""
        with self.engine.begin() as conn:
            conn.execute(
                update(_tokens)  # type: ignore[arg-type]
                .where(
                    _tokens.c.user_id == user_id,
                    _tokens.c.purpose == purpose,
                    _tokens.c.used_at.is_(None),
                )
                .values(used_at=now)
            )
            conn.execute(
                insert(_tokens).values(  # type: ignore[arg-type]
                    id=new_id(),
                    user_id=user_id,
                    purpose=purpose,
                    token_hash=token_hash,
                    created_at=now,
                    expires_at=expires_at,
                )
            )

    # audit -----------------------------------------------------------------------------

    def audit(
        self,
        action: str,
        now: datetime,
        actor_user_id: str | None = None,
        target: str | None = None,
        detail: str | None = None,
    ) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                insert(_audit).values(  # type: ignore[arg-type]
                    id=new_id(),
                    actor_user_id=actor_user_id,
                    action=action,
                    target=target,
                    detail=detail,
                    created_at=now,
                )
            )
