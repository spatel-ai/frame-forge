"""SQLAlchemy model for the banner library (migration 0013; D-067, R-12).

Only `app.banners.service` writes this table. A banner belongs to one user and is never shown to
another. Deleting is soft (`deleted_at`): a past job may still use the stored file."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ..auth import models as _auth_models  # noqa: F401  (registers `users` for the foreign key)
from ..core.database import Base


class Banner(Base):
    __tablename__ = "banners"
    __table_args__ = (Index("ix_banners_user_created", "user_id", text("created_at DESC")),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(Text)
    image_file: Mapped[str] = mapped_column(Text)  # "<id>.png" inside the user's banner folder
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
