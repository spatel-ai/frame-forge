"""SQLAlchemy model for the script library (migration 0007, task T-504; R-43, R-50).

Only `app.scripts.service` writes this table. A script belongs to one user and is never shown to
another (R-12). Deleting is soft (`deleted_at`); a deleted script's text can be saved again as a
new live row because uniqueness only covers live rows."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ..auth import models as _auth_models  # noqa: F401  (registers `users` for the foreign key)
from ..core.database import Base


class Script(Base):
    __tablename__ = "scripts"
    __table_args__ = (
        # One live row per (user, language, exact text); this is what makes save_or_touch safe
        # under concurrent requests.
        Index(
            "uq_scripts_live_text",
            "user_id",
            "language",
            "text_hash",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_scripts_user_last_used", "user_id", text("last_used_at DESC")),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"))
    language: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    text_hash: Mapped[str] = mapped_column(Text)  # sha256 hex of the exact text
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
