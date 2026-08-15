"""add role column to users and create sessions table

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-04 00:00:00

Adds:
  - users.role ("ADMIN" / "USER"), server_default 'USER' so every
    existing row is backfilled to USER automatically with no data
    loss and no manual UPDATE needed.
  - sessions table backing JWT access/refresh token lifecycle:
    single-active-session enforcement, idle timeout, logout, and
    refresh-token rotation/revocation (see models.UserSession and
    repositories/session_repository.py).

Does not touch or delete any existing data.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- users.role -----------------------------------------------------
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_columns = [col["name"] for col in inspector.get_columns("users")]
    if "role" not in existing_columns:
        op.add_column(
            "users",
            sa.Column("role", sa.String(length=20), nullable=False, server_default="USER"),
        )

    # --- sessions ---------------------------------------------------------
    existing_tables = inspector.get_table_names()
    if "sessions" not in existing_tables:
        op.create_table(
            "sessions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("session_token", sa.String(length=64), nullable=False),
            sa.Column("refresh_token", sa.String(length=64), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "last_activity",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column("ip_address", sa.String(length=64), nullable=True),
            sa.Column("user_agent", sa.String(length=512), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
        op.create_index("ix_sessions_session_token", "sessions", ["session_token"], unique=True)
        op.create_index("ix_sessions_refresh_token", "sessions", ["refresh_token"], unique=True)
        op.create_index("idx_sessions_user", "sessions", ["user_id"])
        op.create_index("idx_sessions_user_active", "sessions", ["user_id", "is_active"])


def downgrade() -> None:
    op.drop_index("idx_sessions_user_active", table_name="sessions")
    op.drop_index("idx_sessions_user", table_name="sessions")
    op.drop_index("ix_sessions_refresh_token", table_name="sessions")
    op.drop_index("ix_sessions_session_token", table_name="sessions")
    op.drop_table("sessions")
    op.drop_column("users", "role")
