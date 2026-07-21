"""
=====================================================================
 dummy_integration  ->  staging_db.py
=====================================================================
NEW FILE — Phase 1 addition.

Purpose:
    "Database layer" for the new workflow: a reusable SQLAlchemy
    engine/session, and the GENERIC `source_staging` table that every
    client's uploaded Source file gets written into.

    Per the requirement "DO NOT create separate PostgreSQL tables for
    every Excel structure", this is ONE table shared by every client.
    A Customer file, an Employee file, an Insurance file, an Invoice
    file — all of them land in this same table, with their actual
    columns preserved as JSONB (`row_data`) instead of as real SQL
    columns. Nothing here touches the existing db.py / storage.py
    used by the reconciliation feature.
=====================================================================
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import sessionmaker, declarative_base

from dummy_integration.config import DATABASE_URL

# Independent engine/session for this module, separate from the raw
# psycopg2 connections used in backend/db.py, as requested ("Use
# SQLAlchemy ORM ... Create reusable database session management").
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class SourceStaging(Base):
    """
    One row of this table = one row of a client's uploaded Source
    file, exactly as uploaded, stored generically.
    """
    __tablename__ = "source_staging"

    id = Column(Integer, primary_key=True, index=True)

    # Groups every row from a single upload together.
    batch_id = Column(String, nullable=False, index=True)

    # Which client/project this upload belongs to.
    project_name = Column(String, nullable=False, index=True)

    # What kind of file this was (customer / employee / insurance / invoice ...).
    entity_name = Column(String, nullable=False, index=True)

    # Name of the column detected as the business/primary key for this batch
    # (e.g. "CustomerID", "PolicyNo") — see business_key.py.
    business_key = Column(String, nullable=True)

    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # The actual uploaded row, columns-and-all, schema-less.
    # e.g. {"CustomerID": 101, "Name": "Amit", "City": "Pune", "Balance": 5000}
    row_data = Column(JSONB, nullable=False)


def init_staging_schema():
    """
    Create the source_staging table if it doesn't already exist.
    Mirrors the idempotent `CREATE TABLE IF NOT EXISTS` pattern already
    used in backend/db.py — safe to call every time the app starts.
    """
    Base.metadata.create_all(bind=engine)


def new_batch_id() -> str:
    """One id shared by every row belonging to a single upload."""
    return uuid.uuid4().hex


def save_uploaded_rows(records, project_name: str, entity_name: str,
                        business_key: str, batch_id: str) -> int:
    """
    Persist every row of an uploaded file into source_staging as JSONB.

    Args:
        records: list[dict] — one dict per uploaded row (already JSON-safe).
        project_name / entity_name: which client / which file type.
        business_key: name of the detected business key column.
        batch_id: id tying all these rows together as one upload.

    Returns:
        Number of rows written.
    """
    session = SessionLocal()
    try:
        objects = [
            SourceStaging(
                batch_id=batch_id,
                project_name=project_name,
                entity_name=entity_name,
                business_key=business_key,
                row_data=record,
            )
            for record in records
        ]
        session.bulk_save_objects(objects)
        session.commit()
        return len(objects)
    finally:
        session.close()
