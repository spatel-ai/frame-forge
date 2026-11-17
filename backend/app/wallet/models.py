"""SQLAlchemy models for the wallet tables (migration 0004, task T-301).

Only `app.wallet.ledger` writes these tables (backend rule 1). Ledger rows are never updated or
deleted (rule 2). All amounts are integers (rule 6, D-014)."""

from datetime import datetime
from typing import get_args

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..auth import models as _auth_models  # noqa: F401  (registers `users` for the foreign key)
from ..core.database import Base
from .schemas import LedgerKind

LEDGER_KINDS: tuple[str, ...] = get_args(LedgerKind)


class Wallet(Base):
    __tablename__ = "wallets"
    __table_args__ = (
        CheckConstraint(
            "reserved_credits >= 0 AND balance_credits >= reserved_credits",
            name="ck_wallets_available_not_negative",
        ),
    )

    user_id: Mapped[str] = mapped_column(
        Text, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    balance_credits: Mapped[int] = mapped_column(Integer, server_default="0")
    reserved_credits: Mapped[int] = mapped_column(Integer, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"
    __table_args__ = (
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{k}'" for k in LEDGER_KINDS) + ")",
            name="ck_ledger_entries_kind",
        ),
        UniqueConstraint("kind", "ref_type", "ref_id", name="uq_ledger_entries_kind_ref"),
        Index("ix_ledger_entries_user_created", "user_id", text("created_at DESC")),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    # No ON DELETE action: ledger rows are never deleted (rule 2).
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(Text)
    credits: Mapped[int] = mapped_column(Integer)  # signed change to the balance
    reserved_delta: Mapped[int] = mapped_column(Integer)  # signed change to reserved
    balance_after: Mapped[int] = mapped_column(Integer)
    reserved_after: Mapped[int] = mapped_column(Integer)
    ref_type: Mapped[str] = mapped_column(Text)
    ref_id: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
