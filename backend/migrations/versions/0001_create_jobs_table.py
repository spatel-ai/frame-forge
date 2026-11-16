"""create jobs table

Revision ID: 0001
Revises:
Create Date: 2026-11-17 01:29:03.053415

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('jobs',
    sa.Column('id', sa.Text(), nullable=False),
    sa.Column('status', sa.Text(), nullable=False),
    sa.Column('language', sa.Text(), nullable=False),
    sa.Column('script', sa.Text(), nullable=False),
    sa.Column('image_file', sa.Text(), nullable=False),
    sa.Column('audio_file', sa.Text(), nullable=True),
    sa.Column('audio_duration_seconds', sa.Double(), nullable=True),
    sa.Column('video_file', sa.Text(), nullable=True),
    sa.Column('provider_request_id', sa.Text(), nullable=True),
    sa.Column('video_started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_jobs_status', 'jobs', ['status'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_jobs_status', table_name='jobs')
    op.drop_table('jobs')
