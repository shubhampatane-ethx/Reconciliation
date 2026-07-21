"""
=====================================================================
 DUMMY SERVER  ->  models.py
=====================================================================
NEW FILE — Phase 1 addition.

Purpose:
    Defines the GENERIC "target_data" table that simulates data held
    by an external enterprise system (ERP / SAP / Oracle / Salesforce
    / any REST API).

    Per the requirement "DO NOT create separate PostgreSQL tables for
    every Excel structure", this is a SINGLE table for every client /
    every project. The actual business columns (CustomerID, Name,
    Premium, GST, Salary ... whatever a given client's target system
    happens to have) are never modelled as real columns — they all
    live inside the `row_data` JSONB column instead. This means a
    brand-new client with a brand-new set of fields can be onboarded
    without ANY schema migration.
=====================================================================
"""

from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from dummy_server.database import Base


class TargetData(Base):
    """
    One row of this table = one row of "target" data belonging to one
    (project_name, entity_name) pair, exactly as it would look coming
    back from a real external system.
    """

    __tablename__ = "target_data"

    # Surrogate primary key for this table itself.
    id = Column(Integer, primary_key=True, index=True)

    # Which client/project this target row belongs to (e.g. "acme_corp").
    # Lets many clients share the same physical table safely.
    project_name = Column(String, nullable=False, index=True)

    # Which "kind" of data this is for that project (e.g. "customer",
    # "employee", "insurance", "invoice") — purely descriptive, does not
    # affect the schema.
    entity_name = Column(String, nullable=False, index=True)

    # Name of the business/primary key column WITHIN row_data for this
    # entity (e.g. "CustomerID", "PolicyNo"). Stored so consumers of the
    # JSON know which JSON field to treat as the unique key without
    # having to guess.
    business_key = Column(String, nullable=True)

    # When this target row was last refreshed. Defaults to "now" and is
    # updated automatically by Postgres whenever the row changes.
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                         onupdate=func.now(), nullable=False)

    # THE important column: the entire source row, exactly as the
    # external system holds it, stored as schema-less JSONB.
    # Example: {"CustomerID": 101, "Name": "Amit", "City": "Pune", "Balance": 5000}
    row_data = Column(JSONB, nullable=False)
