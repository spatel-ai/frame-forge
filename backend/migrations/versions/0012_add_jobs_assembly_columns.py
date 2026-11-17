"""add the banner and video-storage columns to jobs (D-066, D-019; S3 storage, owner 2026-11-17)

- `jobs.ai_video_url` (text, nullable): fal's link to the AI video while banners are added; the
  fallback when the video cannot be stored (D-065 behaviour).
- `jobs.ai_video_key` (text, nullable): the AI video's key in S3.
- `jobs.ai_video_file` (text, nullable): the AI video's local file (mock mode / no bucket).
- `jobs.video_key` (text, nullable): the delivered video's key in S3.
- `jobs.banners_applied` (boolean, nullable): true when the banners were added, false when the
  video was delivered without them (D-019); NULL when banners were not in use.
- `jobs.assembly_attempts` (integer, not null, default 0): failed tries of the free banner step.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-17 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0012'
down_revision: Union[str, Sequence[str], None] = '0011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('jobs', sa.Column('ai_video_url', sa.Text(), nullable=True))
    op.add_column('jobs', sa.Column('ai_video_key', sa.Text(), nullable=True))
    op.add_column('jobs', sa.Column('ai_video_file', sa.Text(), nullable=True))
    op.add_column('jobs', sa.Column('video_key', sa.Text(), nullable=True))
    op.add_column('jobs', sa.Column('banners_applied', sa.Boolean(), nullable=True))
    op.add_column(
        'jobs',
        sa.Column('assembly_attempts', sa.Integer(), server_default='0', nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('jobs', 'assembly_attempts')
    op.drop_column('jobs', 'banners_applied')
    op.drop_column('jobs', 'video_key')
    op.drop_column('jobs', 'ai_video_file')
    op.drop_column('jobs', 'ai_video_key')
    op.drop_column('jobs', 'ai_video_url')
