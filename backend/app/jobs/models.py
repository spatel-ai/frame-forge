"""SQLAlchemy model for the jobs table (PostgreSQL; built by the Alembic migrations)."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Double, ForeignKey, Index, Integer, Text, false
from sqlalchemy.orm import Mapped, mapped_column

from ..auth import models as _auth_models  # noqa: F401  (registers `users` for the foreign key)
from ..banners import models as _banner_models  # noqa: F401  (registers `banners` for the FK)
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
    # Migration 0011 (T-553, D-065, R-24, R-74): the provider's link to the finished video and
    # when the provider deletes it. NULL for mock jobs (they keep `video_file`) and older jobs.
    video_url: Mapped[str | None] = mapped_column(Text)
    video_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Migration 0012 (D-066, D-019; S3 storage, owner 2026-11-17). While banners are added, the
    # AI video is fal's link (`ai_video_url`) or a local file (`ai_video_file`, mock mode); once
    # copied to S3 its key is `ai_video_key`. The delivered video's S3 key is `video_key`.
    ai_video_url: Mapped[str | None] = mapped_column(Text)
    ai_video_key: Mapped[str | None] = mapped_column(Text)
    ai_video_file: Mapped[str | None] = mapped_column(Text)
    video_key: Mapped[str | None] = mapped_column(Text)
    # True: banners added. False: delivered without them after the free step kept failing
    # (D-019). NULL: banners were not in use for this job.
    banners_applied: Mapped[bool | None] = mapped_column(Boolean)
    # Failed tries of the free assembling step; at `assembly_max_attempts` the fallback applies.
    assembly_attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    # D-067: the customer's banner chosen at approval; the job folder keeps its own copy.
    banner_id: Mapped[str | None] = mapped_column(Text, ForeignKey("banners.id"))
