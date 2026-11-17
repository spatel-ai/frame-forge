"""SQLAlchemy model for the jobs table (PostgreSQL; built by the Alembic migrations)."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Double, ForeignKey, Index, Integer, Text, false
from sqlalchemy.orm import Mapped, mapped_column

from ..auth import models as _auth_models  # noqa: F401  (registers `users` for the foreign key)
from ..core.database import Base
from ..scripts import models as _script_models  # noqa: F401  (registers `scripts` for the FK)


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
    # Migration 0005 (T-303, T-304). The video price in whole credits, fixed when the voice is
    # ready (D-006); NULL before that.
    price_credits: Mapped[int | None] = mapped_column(Integer)
    # Approvals so far; the hold of attempt n has the reference `<job_id>#<n>` (D-039).
    approve_attempt: Mapped[int] = mapped_column(Integer, server_default="0")
    # A paid call's outcome is unknown; staff must review the job (D-005, Q-19).
    needs_review: Mapped[bool] = mapped_column(Boolean, server_default=false())
    # Migration 0008 (T-502, R-14, D-045): the consent sentence version the customer agreed to and
    # when. NULL for jobs made before M5.
    consent_version: Mapped[str | None] = mapped_column(Text)
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Migration 0010 (T-505, R-43, R-51): the library script this job came from. NULL for jobs made
    # before M5. No cascade: deleting a script (soft delete) never changes a job, which keeps its
    # own copy of the text.
    script_id: Mapped[str | None] = mapped_column(Text, ForeignKey("scripts.id"))
