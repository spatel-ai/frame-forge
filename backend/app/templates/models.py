"""SQLAlchemy model for banner templates (migration 0008, task T-506; R-44, R-46, R-47).

A template is a company-supplied start or end clip (D-058). Templates are retired (`active`
false), never deleted, because old jobs may still point at them (backend CLAUDE.md rule 3)."""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ..auth import models as _auth_models  # noqa: F401  (registers `users` for the foreign key)
from ..core.database import Base


class Template(Base):
    __tablename__ = "templates"
    __table_args__ = (
        CheckConstraint("kind IN ('start', 'end')", name="ck_templates_kind"),
        CheckConstraint("duration_ms > 0", name="ck_templates_duration"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    clip_file: Mapped[str] = mapped_column(Text)  # file name inside data_dir/templates
    preview_file: Mapped[str] = mapped_column(Text)  # the same file as clip_file for now
    duration_ms: Mapped[int] = mapped_column(Integer)
    has_audio: Mapped[bool] = mapped_column(Boolean)
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_by: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
