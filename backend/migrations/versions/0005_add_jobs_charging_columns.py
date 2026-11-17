"""add jobs charging columns: price_credits, approve_attempt, needs_review (T-303, T-304)

- `price_credits`: the video price in whole credits, fixed when the voice is ready (D-006, D-014).
  NULL until then.
- `approve_attempt`: how many times the job was approved; each attempt has its own hold
  reference `<job_id>#<attempt>` (D-039). 0 until the first approval.
- `needs_review`: the outcome of a paid call is unknown and staff must look at the job (D-005,
  Q-19).

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-17 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('jobs', sa.Column('price_credits', sa.Integer(), nullable=True))
    op.add_column(
        'jobs',
        sa.Column('approve_attempt', sa.Integer(), server_default='0', nullable=False),
    )
    op.add_column(
        'jobs',
        sa.Column('needs_review', sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('jobs', 'needs_review')
    op.drop_column('jobs', 'approve_attempt')
    op.drop_column('jobs', 'price_credits')
