"""add jobs.video_url and jobs.video_expires_at: play the video from the fal.ai link (T-553)

- `jobs.video_url` (text, nullable): fal's link to the finished video (D-065, R-24, R-74). NULL for
  mock jobs, which keep `video_file`, and for jobs made before R1.
- `jobs.video_expires_at` (timestamptz, nullable): when fal deletes the video (30 days, D-065).

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-17 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0011'
down_revision: Union[str, Sequence[str], None] = '0010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('jobs', sa.Column('video_url', sa.Text(), nullable=True))
    op.add_column('jobs', sa.Column('video_expires_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('jobs', 'video_expires_at')
    op.drop_column('jobs', 'video_url')
