"""create wallet tables: wallets, ledger_entries (T-301)

The database is the last line of defence for money (D-004): a CHECK forbids a negative available
balance and UNIQUE (kind, ref_type, ref_id) lets each payment or job step count once. The kind
list is written out here, not imported, so this migration never changes when app code does; a
test compares it with `LedgerKind` in app/wallet/schemas.py.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-17 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LEDGER_KINDS = (
    'purchase',
    'grant',
    'voice_charge',
    'voice_return',
    'hold',
    'capture',
    'release',
    'adjustment',
    'refund',
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('wallets',
    sa.Column('user_id', sa.Text(), nullable=False),
    sa.Column('balance_credits', sa.Integer(), server_default='0', nullable=False),
    sa.Column('reserved_credits', sa.Integer(), server_default='0', nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
              nullable=False),
    sa.CheckConstraint(
        'reserved_credits >= 0 AND balance_credits >= reserved_credits',
        name='ck_wallets_available_not_negative',
    ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id'),
    )
    kinds = ', '.join(f"'{k}'" for k in LEDGER_KINDS)
    op.create_table('ledger_entries',
    sa.Column('id', sa.Text(), nullable=False),
    sa.Column('user_id', sa.Text(), nullable=False),
    sa.Column('kind', sa.Text(), nullable=False),
    sa.Column('credits', sa.Integer(), nullable=False),
    sa.Column('reserved_delta', sa.Integer(), nullable=False),
    sa.Column('balance_after', sa.Integer(), nullable=False),
    sa.Column('reserved_after', sa.Integer(), nullable=False),
    sa.Column('ref_type', sa.Text(), nullable=False),
    sa.Column('ref_id', sa.Text(), nullable=False),
    sa.Column('created_by', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint(f'kind IN ({kinds})', name='ck_ledger_entries_kind'),
    # No ON DELETE action: ledger rows are never deleted (backend rule 2), so a user with money
    # history cannot be deleted by accident.
    sa.ForeignKeyConstraint(['user_id'], ['users.id']),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('kind', 'ref_type', 'ref_id', name='uq_ledger_entries_kind_ref'),
    )
    op.create_index(
        'ix_ledger_entries_user_created',
        'ledger_entries',
        ['user_id', sa.text('created_at DESC')],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_ledger_entries_user_created', table_name='ledger_entries')
    op.drop_table('ledger_entries')
    op.drop_table('wallets')
