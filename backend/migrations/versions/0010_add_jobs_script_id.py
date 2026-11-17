"""add jobs.script_id: the library script a job came from (T-505)

- `jobs.script_id` (text, nullable, FK scripts.id, no cascade): NULL for jobs made before M5 or
  without a library script. Deleting a script is a soft delete and never touches a job (R-43, R-51).

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-18 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0010'
down_revision: Union[str, Sequence[str], None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('jobs', sa.Column('script_id', sa.Text(), nullable=True))
    op.create_foreign_key('fk_jobs_script_id_scripts', 'jobs', 'scripts', ['script_id'], ['id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_jobs_script_id_scripts', 'jobs', type_='foreignkey')
    op.drop_column('jobs', 'script_id')
