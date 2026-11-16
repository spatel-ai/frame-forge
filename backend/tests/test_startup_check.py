"""The server refuses to start on a database that is not migrated to the newest revision.

Found in the T-201/T-202 review: a database at revision 0001 used to start and then fail on
every auth route. R-01."""

import pytest
from alembic import command
from sqlalchemy import create_engine

from app.core.database import DatabaseNotReady, check_database, latest_revision


def test_an_up_to_date_database_passes(database_url):
    """R-01: a database at head starts."""
    engine = create_engine(database_url)
    try:
        check_database(engine)
    finally:
        engine.dispose()


def test_a_database_behind_head_is_refused(empty_schema):
    """R-01: a database at an older revision gets a message saying how to fix it."""
    command.upgrade(empty_schema.alembic_config(), "0001")
    engine = create_engine(empty_schema.url)
    try:
        with pytest.raises(DatabaseNotReady, match="alembic upgrade head"):
            check_database(engine)
    finally:
        engine.dispose()


def test_a_never_migrated_database_is_refused(empty_schema):
    """R-01: an empty database gets the same message."""
    engine = create_engine(empty_schema.url)
    try:
        with pytest.raises(DatabaseNotReady, match="alembic upgrade head"):
            check_database(engine)
    finally:
        engine.dispose()


def test_latest_revision_is_known():
    assert latest_revision()
