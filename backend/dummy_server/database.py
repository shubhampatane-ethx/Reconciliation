"""
=====================================================================
 DUMMY SERVER  ->  database.py
=====================================================================
NEW FILE — Phase 1 addition.

Purpose:
    Reusable SQLAlchemy engine / session management for the Dummy
    Server, following the "Database Layer" separation asked for in
    the requirements (API layer / Service layer / Database layer /
    Models / Schemas all kept apart).

    This module owns ONLY the Dummy Server's connection to Postgres.
    It does not know anything about reconciliation, comparison, or
    reporting — per the spec, the Dummy Server's only job is to read
    target data and hand back JSON.
=====================================================================
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from dummy_server.config import DATABASE_URL

# `pool_pre_ping` keeps the pool healthy across long-lived dev sessions
# (avoids "server closed the connection unexpectedly" errors).
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

# Each request gets its own Session via the get_db() dependency below;
# sessions are never shared across requests.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class every ORM model in this Dummy Server inherits from.
Base = declarative_base()


def get_db():
    """
    FastAPI dependency that yields a database session and guarantees
    it is closed afterwards, even if the request raises.

    Usage in an endpoint:
        def endpoint(db: Session = Depends(get_db)): ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
