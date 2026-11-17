"""create scripts table: the customer's script library (T-504)

- `scripts`: one row per script a customer used, saved automatically (R-43, R-50). `text_hash`
  is the sha256 hex of the exact text. A partial UNIQUE index on (user_id, language, text_hash)
  WHERE deleted_at IS NULL keeps one live row per text, so a concurrent save is a touch, and a
  deleted script can be saved again as a new row. No ON DELETE action on the user key.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-18 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0007'
down_revision: Union[str, Sequence[str], None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('scripts',
    sa.Column('id', sa.Text(), nullable=False),
    sa.Column('user_id', sa.Text(), nullable=False),
    sa.Column('language', sa.Text(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('text_hash', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id']),
    sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('uq_scripts_live_text', 'scripts', ['user_id', 'language', 'text_hash'],
                    unique=True, postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_index('ix_scripts_user_last_used', 'scripts',
                    ['user_id', sa.text('last_used_at DESC')])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_scripts_user_last_used', table_name='scripts')
    op.drop_index('uq_scripts_live_text', table_name='scripts',
                  postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_table('scripts')
