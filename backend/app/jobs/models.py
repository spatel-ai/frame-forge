"""SQLAlchemy model for the jobs table. Columns mirror the SQLite schema in db.py."""

from datetime import datetime

from sqlalchemy import DateTime, Double, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..auth import models as _auth_models  # noqa: F401  (registers `users` for the foreign key)
from ..core.database import Base


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_status", "status"),
        Index("ix_jobs_user_id", "user_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    status: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(Text)
    script: Mapped[str] = mapped_column(Text)
    image_file: Mapped[str] = mapped_column(Text)
    audio_file: Mapped[str | None] = mapped_column(Text)
    audio_duration_seconds: Mapped[float | None] = mapped_column(Double)
    video_file: Mapped[str | None] = mapped_column(Text)
    provider_request_id: Mapped[str | None] = mapped_column(Text)
    video_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # NULL for jobs made before accounts existed (T-204); they are never shown to anyone.
    user_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id", ondelete="SET NULL"))
