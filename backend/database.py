"""
SQLAlchemy engine / session configuration for the Reconciliation app.

This module owns the SQLAlchemy connection used for the `users` table
(and any future ORM-backed models). The rest of the app's Postgres
access (series / datasets / row-value history in db.py) is unrelated
and keeps using psycopg2 directly — this module does not touch that.

Configuration:
    The connection string is built from, in order of priority:
      1. DATABASE_URL, if set (used as-is).
      2. POSTGRES_HOST / POSTGRES_PORT / POSTGRES_DB / POSTGRES_USER /
         POSTGRES_PASSWORD, combined into a postgresql+psycopg2 URL.
      3. A local-dev fallback matching docker-compose.yml.

Schema management:
    Tables are created and evolved exclusively through Alembic
    migrations (see backend/alembic/). This module intentionally does
    NOT call Base.metadata.create_all() — run `alembic upgrade head`
    (see backend/alembic.ini) to create/update tables instead.
"""

import os
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker


def _build_database_url() -> str:
    explicit_url = os.environ.get("DATABASE_URL")
    if explicit_url:
        return explicit_url

    host = os.environ.get("POSTGRES_HOST", "localhost")
    port = os.environ.get("POSTGRES_PORT", "5432")
    db_name = os.environ.get("POSTGRES_DB", "consistency")
    user = os.environ.get("POSTGRES_USER", "consistency")
    password = os.environ.get("POSTGRES_PASSWORD", "consistency")

    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db_name}"


DATABASE_URL = _build_database_url()

Base = declarative_base()

# Engine and session factory are created lazily so the app starts even
# when Postgres is unreachable (e.g. local dev without Docker).
_engine = None
_SessionLocal = None


def _get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
    return _engine


def _get_session_factory():
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=_get_engine(), autoflush=False, autocommit=False, future=True)
    return _SessionLocal


@contextmanager
def get_session():
    """Context manager yielding a SQLAlchemy session that commits on
    success and rolls back on any exception.

    Usage:
        with get_session() as session:
            session.add(obj)
    """
    session = _get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def is_available() -> bool:
    """Cheap reachability check for the SQLAlchemy-managed connection."""
    try:
        with _get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
