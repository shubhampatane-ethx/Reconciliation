"""create series, datasets, series_versions, series_row_values tables

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-29 00:00:00

Brings the remaining four Postgres tables under Alembic management.
Previously these were created by a hand-written `CREATE TABLE IF NOT
EXISTS` string executed by db.init_schema() on every app startup
(see the old db.py SCHEMA constant). That worked, but meant this
project had two competing sources of truth for schema: Alembic for
`users`, and ad-hoc runtime DDL for everything else. This migration
(together with the ORM models in models.py) makes Alembic the single
owner of every table's schema instead — db.init_schema() no longer
runs any DDL; it only verifies the tables below already exist.

Table-by-table:
    series              One row per dataset a user is tracking over
                         time. Parent of series_versions.
    datasets             Denormalised companion to `series`, same id,
                          for fast chatbot lookups.
    series_versions       One row per upload/version of a series.
    series_row_values      One row per (series, version, key-row)
                            snapshot — what the value-history view is
                            pivoted from. By far the largest table.

If you are running this against a database that already has these
tables (created by the old runtime SCHEMA DDL before this migration
existed), Alembic will fail with "relation already exists" — in that
case stamp the DB instead of upgrading:

    alembic stamp 0002

so Alembic's version table agrees with reality without trying to
re-create tables that are already there. Fresh databases (e.g. a new
`docker compose up` with an empty volume) should just run
`alembic upgrade head` as normal.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = inspector.get_table_names()

    # ── series ───────────────────────────────────────────────────────
    if "series" not in existing:
     op.create_table(
        "series",
        sa.Column("series_id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("key_columns", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
     )
     op.create_index("idx_series_user", "series", ["user_id"])

    # ── datasets ─────────────────────────────────────────────────────
    if "datasets" not in existing:
     op.create_table(
        "datasets",
        sa.Column("dataset_id", sa.Text(), primary_key=True),
        sa.Column("dataset_name", sa.Text(), nullable=False),
        sa.Column("original_file_name", sa.Text(), nullable=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "upload_timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("record_count", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("file_type", sa.Text(), nullable=True),
        sa.Column("column_names", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "embedding_status",
            sa.String(length=50),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "reconciliation_history",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default=sa.text("'[]'::jsonb"),
        ),
     )
     op.create_index("idx_datasets_user", "datasets", ["user_id"])

    # ── series_versions ──────────────────────────────────────────────
    if "series_versions" not in existing:
     op.create_table(
        "series_versions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "series_id",
            sa.Text(),
            sa.ForeignKey("series.series_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("filename", sa.Text(), nullable=True),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column("column_count", sa.Integer(), nullable=True),
        sa.Column("key_columns", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("diff_summary", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("report_file", sa.Text(), nullable=True),
        sa.UniqueConstraint(
            "series_id", "version", name="series_versions_series_id_version_key"
        ),
     )

    # ── series_row_values ────────────────────────────────────────────
    if "series_row_values" not in existing:
     op.create_table(
        "series_row_values",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "series_id",
            sa.Text(),
            sa.ForeignKey("series.series_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("row_key", sa.Text(), nullable=False),
        sa.Column("row_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.UniqueConstraint(
            "series_id", "version", "row_key",
            name="series_row_values_series_id_version_row_key_key",
        ),
     )
     op.create_index(
        "idx_series_row_values_lookup", "series_row_values", ["series_id", "row_key"]
     )


def downgrade() -> None:
    op.drop_index("idx_series_row_values_lookup", table_name="series_row_values")
    op.drop_table("series_row_values")

    op.drop_table("series_versions")

    op.drop_index("idx_datasets_user", table_name="datasets")
    op.drop_table("datasets")

    op.drop_index("idx_series_user", table_name="series")
    op.drop_table("series")
