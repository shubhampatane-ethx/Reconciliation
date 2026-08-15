"""create reconciliation mapping session and detailed mapping tables

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-15 00:00:00

Adds:
  - reconciliation_mapping_sessions table: tracks persistent schema & row mapping sessions
  - header_column_mappings table: stores dynamic column-to-column mappings with confidence scores and multi-signal explanations
  - row_index_mappings table: stores explicit index-based row-to-row pairings (Source Index -> Target Index)

Does not touch or delete any existing data.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_tables = inspector.get_table_names()

    if "reconciliation_mapping_sessions" not in existing_tables:
        op.create_table(
            "reconciliation_mapping_sessions",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("source_dataset_id", sa.Text(), nullable=True),
            sa.Column("target_dataset_id", sa.Text(), nullable=True),
            sa.Column("source_version", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("target_version", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("mapping_mode", sa.String(length=30), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )
        op.create_index("idx_mapping_sessions_user", "reconciliation_mapping_sessions", ["user_id"])
        op.create_index(
            "idx_mapping_sessions_datasets",
            "reconciliation_mapping_sessions",
            ["source_dataset_id", "target_dataset_id"],
        )

    if "header_column_mappings" not in existing_tables:
        op.create_table(
            "header_column_mappings",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column(
                "session_id",
                sa.String(length=64),
                sa.ForeignKey("reconciliation_mapping_sessions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("source_column", sa.Text(), nullable=False),
            sa.Column("target_column", sa.Text(), nullable=False),
            sa.Column("confidence_score", sa.Float(), nullable=False, server_default="1.0"),
            sa.Column("is_key", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("match_explanation", JSONB(), nullable=True),
        )
        op.create_index("idx_header_mappings_session", "header_column_mappings", ["session_id"])

    if "row_index_mappings" not in existing_tables:
        op.create_table(
            "row_index_mappings",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column(
                "session_id",
                sa.String(length=64),
                sa.ForeignKey("reconciliation_mapping_sessions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("source_index", sa.Integer(), nullable=False),
            sa.Column("target_index", sa.Integer(), nullable=False),
            sa.Column("source_internal_id", sa.Text(), nullable=True),
            sa.Column("target_internal_id", sa.Text(), nullable=True),
        )
        op.create_index("idx_row_mappings_session", "row_index_mappings", ["session_id"])


def downgrade() -> None:
    op.drop_index("idx_row_mappings_session", table_name="row_index_mappings")
    op.drop_table("row_index_mappings")
    op.drop_index("idx_header_mappings_session", table_name="header_column_mappings")
    op.drop_table("header_column_mappings")
    op.drop_index("idx_mapping_sessions_datasets", table_name="reconciliation_mapping_sessions")
    op.drop_index("idx_mapping_sessions_user", table_name="reconciliation_mapping_sessions")
    op.drop_table("reconciliation_mapping_sessions")
