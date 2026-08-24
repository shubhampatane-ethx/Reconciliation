"""create reconciliation jobs table for Kafka asynchronous processing

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-19 00:00:00

Adds:
  - reconciliation_jobs table: tracks asynchronous reconciliation jobs processed via Kafka workers
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_tables = inspector.get_table_names()

    if "reconciliation_jobs" not in existing_tables:
        op.create_table(
            "reconciliation_jobs",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("job_type", sa.String(length=50), nullable=False, server_default="AR_RECONCILE"),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="QUEUED_KAFKA"),
            sa.Column("progress_pct", sa.Float(), nullable=False, server_default="0.0"),
            sa.Column("source_filename", sa.String(length=255), nullable=True),
            sa.Column("target_filename", sa.String(length=255), nullable=True),
            sa.Column("payload_params", JSONB(), nullable=True),
            sa.Column("result_summary", JSONB(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
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
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("idx_recon_jobs_user", "reconciliation_jobs", ["user_id"])
        op.create_index("idx_recon_jobs_status", "reconciliation_jobs", ["status"])


def downgrade() -> None:
    op.drop_index("idx_recon_jobs_status", table_name="reconciliation_jobs")
    op.drop_index("idx_recon_jobs_user", table_name="reconciliation_jobs")
    op.drop_table("reconciliation_jobs")
