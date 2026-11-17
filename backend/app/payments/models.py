"""SQLAlchemy models for the payment tables (migration 0006, task T-402).

Only `app.payments.service` writes these tables. Money is integers only (D-014): `amount_paise`
is what Razorpay charges, `credits` what the wallet receives (₹1 = 1 credit, D-007)."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..auth import models as _auth_models  # noqa: F401  (registers `users` for the foreign key)
from ..core.database import Base

CREATED = "created"
PAID = "paid"
FAILED = "failed"


class PaymentOrder(Base):
    __tablename__ = "payment_orders"
    __table_args__ = (
        CheckConstraint("status IN ('created', 'paid', 'failed')", name="ck_payment_orders_status"),
        CheckConstraint("amount_paise > 0 AND credits > 0", name="ck_payment_orders_positive"),
        CheckConstraint(
            "price_paise = credits * 100 AND fee_paise >= 0 AND fee_gst_paise >= 0 "
            "AND amount_paise = price_paise + fee_paise + fee_gst_paise",
            name="ck_payment_orders_amount_parts",
        ),
        CheckConstraint(
            "status <> 'paid' OR (razorpay_payment_id IS NOT NULL AND paid_at IS NOT NULL)",
            name="ck_payment_orders_paid_has_payment",
        ),
        UniqueConstraint("razorpay_order_id", name="uq_payment_orders_razorpay_order_id"),
        UniqueConstraint("razorpay_payment_id", name="uq_payment_orders_razorpay_payment_id"),
        Index("ix_payment_orders_user_id", "user_id"),
        Index("ix_payment_orders_status_created", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"))
    razorpay_order_id: Mapped[str] = mapped_column(Text)
    amount_paise: Mapped[int] = mapped_column(Integer)  # total charged (D-060)
    price_paise: Mapped[int] = mapped_column(Integer)  # credits × 100
    fee_paise: Mapped[int] = mapped_column(Integer)
    fee_gst_paise: Mapped[int] = mapped_column(Integer)
    credits: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text, server_default=CREATED)
    razorpay_payment_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebhookEvent(Base):
    __tablename__ = "webhook_events"

    event_id: Mapped[str] = mapped_column(Text, primary_key=True)
    event_type: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
