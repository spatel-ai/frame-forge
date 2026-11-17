"""create payment tables: payment_orders, webhook_events (T-402)

- `payment_orders`: one row per Razorpay order we created. `status` is created, paid or failed.
  `failed` never closes an order: a later capture still credits it (HLD §5.1). The UNIQUE
  `razorpay_payment_id` lets one payment pay one order at most (D-016). Money is integers only
  (D-014): `amount_paise` is what Razorpay charges (price + fee + GST on the fee, D-060),
  `credits` what the wallet gets.
- `webhook_events`: one row per Razorpay webhook delivery we accepted, keyed on the
  `x-razorpay-event-id` header, so a repeated delivery is a no-op (backend rule 8).

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-17 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('payment_orders',
    sa.Column('id', sa.Text(), nullable=False),
    sa.Column('user_id', sa.Text(), nullable=False),
    sa.Column('razorpay_order_id', sa.Text(), nullable=False),
    sa.Column('amount_paise', sa.Integer(), nullable=False),
    sa.Column('price_paise', sa.Integer(), nullable=False),
    sa.Column('fee_paise', sa.Integer(), nullable=False),
    sa.Column('fee_gst_paise', sa.Integer(), nullable=False),
    sa.Column('credits', sa.Integer(), nullable=False),
    sa.Column('status', sa.Text(), server_default='created', nullable=False),
    sa.Column('razorpay_payment_id', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('created', 'paid', 'failed')", name='ck_payment_orders_status'),
    sa.CheckConstraint('amount_paise > 0 AND credits > 0', name='ck_payment_orders_positive'),
    # D-060: the customer pays the fee; the total is the only amount sent to Razorpay.
    sa.CheckConstraint(
        'price_paise = credits * 100 AND fee_paise >= 0 AND fee_gst_paise >= 0 '
        'AND amount_paise = price_paise + fee_paise + fee_gst_paise',
        name='ck_payment_orders_amount_parts',
    ),
    # A paid order always names the payment that paid it.
    sa.CheckConstraint(
        "status <> 'paid' OR (razorpay_payment_id IS NOT NULL AND paid_at IS NOT NULL)",
        name='ck_payment_orders_paid_has_payment',
    ),
    # No ON DELETE action: an order is a money record, like the ledger.
    sa.ForeignKeyConstraint(['user_id'], ['users.id']),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('razorpay_order_id', name='uq_payment_orders_razorpay_order_id'),
    sa.UniqueConstraint('razorpay_payment_id', name='uq_payment_orders_razorpay_payment_id'),
    )
    op.create_index('ix_payment_orders_user_id', 'payment_orders', ['user_id'])
    op.create_index('ix_payment_orders_status_created', 'payment_orders', ['status', 'created_at'])
    op.create_table('webhook_events',
    sa.Column('event_id', sa.Text(), nullable=False),
    sa.Column('event_type', sa.Text(), nullable=False),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('event_id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('webhook_events')
    op.drop_index('ix_payment_orders_status_created', table_name='payment_orders')
    op.drop_index('ix_payment_orders_user_id', table_name='payment_orders')
    op.drop_table('payment_orders')
