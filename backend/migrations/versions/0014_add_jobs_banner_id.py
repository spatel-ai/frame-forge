"""add jobs.banner_id: the customer's banner chosen for this video (D-067)

- `jobs.banner_id` (text, nullable, FK banners.id, no ON DELETE action): the banner picked at
  approval. The job also keeps its own copy of the image (`banner.png` in the job folder), so
  deleting the banner later never changes the video.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-17 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0014'
down_revision: Union[str, Sequence[str], None] = '0013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('jobs', sa.Column('banner_id', sa.Text(), nullable=True))
    op.create_foreign_key('fk_jobs_banner_id_banners', 'jobs', 'banners', ['banner_id'], ['id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_jobs_banner_id_banners', 'jobs', type_='foreignkey')
    op.drop_column('jobs', 'banner_id')
