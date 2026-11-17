"""add consent columns to jobs: what the customer agreed to and when (T-502)

- `jobs.consent_version` (text) and `jobs.consent_at` (timestamptz), both nullable: jobs made
  before M5 have no recorded consent (R-14, D-045).

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-18 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0009'
down_revision: Union[str, Sequence[str], None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('jobs', sa.Column('consent_version', sa.Text(), nullable=True))
    op.add_column('jobs', sa.Column('consent_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('jobs', 'consent_at')
    op.drop_column('jobs', 'consent_version')
