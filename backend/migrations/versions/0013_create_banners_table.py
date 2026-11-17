"""create banners table: the customer's private banner library (D-067)

- `banners`: one row per uploaded logo or banner image (R-12: only the owner sees it). The image
  itself is a PNG under DATA_DIR/banners/<user_id>/<id>.png. Deleting is soft (`deleted_at`) because
  a past job may still point at the file. No ON DELETE action on the user key.

Revision ID: 0013
Revises: 0011
Create Date: 2026-11-17 12:00:00.000000

NOTE: written while only 0011 existed in this worktree (0012 is being written elsewhere for job
columns). The integrator must set `down_revision = '0012'` at merge.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0013'
down_revision: Union[str, Sequence[str], None] = '0011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('banners',
    sa.Column('id', sa.Text(), nullable=False),
    sa.Column('user_id', sa.Text(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('image_file', sa.Text(), nullable=False),
    sa.Column('width', sa.Integer(), nullable=False),
    sa.Column('height', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id']),
    sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_banners_user_created', 'banners',
                    ['user_id', sa.text('created_at DESC')])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_banners_user_created', table_name='banners')
    op.drop_table('banners')
