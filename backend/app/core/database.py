"""Database engine construction (synchronous SQLAlchemy, decision D-023)."""

from sqlalchemy import Engine, create_engine


def make_engine(url: str) -> Engine:
    return create_engine(url, pool_pre_ping=True)
