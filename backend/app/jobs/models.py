"""SQLAlchemy model for the jobs table. Columns mirror the SQLite schema in db.py."""

from datetime import datetime

from sqlalchemy import DateTime, Double, Index, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_status", "status"),)

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
