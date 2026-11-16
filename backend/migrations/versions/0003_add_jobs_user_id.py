"""add jobs.user_id: every job has an owner (T-204)

Existing rows keep NULL; a job with no owner is never shown to anyone.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-17 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('jobs', sa.Column('user_id', sa.Text(), nullable=True))
    op.create_foreign_key(
        'fk_jobs_user_id_users', 'jobs', 'users', ['user_id'], ['id'], ondelete='SET NULL'
    )
    op.create_index('ix_jobs_user_id', 'jobs', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_jobs_user_id', table_name='jobs')
    op.drop_constraint('fk_jobs_user_id_users', 'jobs', type_='foreignkey')
    op.drop_column('jobs', 'user_id')
