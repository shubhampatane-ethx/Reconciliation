"""
Admin-only routes — system-wide visibility across every user's data.

Every route in this blueprint is protected by @admin_required (auth.py),
which enforces login + an active, non-idle-timed-out session + role ==
"ADMIN" before the route body ever runs. Normal USER accounts get a
403 from every route here; there is no route in this file a non-admin
can reach.

These are additive, read-mostly endpoints for the Admin Dashboard.
They do not touch reconciliation logic, metadata generation, uploads,
or any other existing business logic — they only ever SELECT across
existing tables (users, sessions, series, datasets), plus one
narrowly-scoped user-management action (deactivate/reactivate/role
change), all via the existing SQLAlchemy models in models.py.
"""

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select

from database import get_session
from models import Dataset, Series, User, UserSession
from repositories import session_repository, user_repository
from auth import admin_required

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")


@admin_bp.route("/users", methods=["GET"])
@admin_required
def list_all_users():
    """Every registered user account (admin + all normal users)."""
    return jsonify({"users": user_repository.list_users()}), 200


@admin_bp.route("/users/<int:user_id>", methods=["PATCH"])
@admin_required
def update_user(user_id):
    """Admin user management: activate/deactivate an account or change
    its role. Deactivating a user also kills every active session they
    have open, so a deactivated account can't keep using tokens issued
    before the deactivation."""
    data = request.get_json(silent=True) or {}
    updates = {}
    if "is_active" in data:
        updates["is_active"] = bool(data["is_active"])
    if "role" in data and data["role"] in (User.ROLE_ADMIN, User.ROLE_USER):
        updates["role"] = data["role"]

    if not updates:
        return jsonify({"error": "No valid fields to update (is_active, role)."}), 400

    user = user_repository.get_user_by_id(user_id)
    if user is None:
        return jsonify({"error": "User not found."}), 404
    if user["email"] == "admin@gmail.com":
        return jsonify({"error": "The built-in admin account cannot be modified."}), 400

    updated = user_repository.update_user(user_id, **updates)
    if updates.get("is_active") is False:
        session_repository.deactivate_all_for_user(user_id)
    return jsonify({"user": updated}), 200


@admin_bp.route("/sessions", methods=["GET"])
@admin_required
def list_all_sessions():
    """Every active session across every user, for security visibility."""
    with get_session() as db_session:
        stmt = select(UserSession).where(UserSession.is_active.is_(True)).order_by(UserSession.last_activity.desc())
        sessions = db_session.scalars(stmt).all()
        return jsonify({"sessions": [s.to_dict() for s in sessions]}), 200


@admin_bp.route("/series", methods=["GET"])
@admin_required
def list_all_series():
    """Every series (uploaded dataset tracked over time) across every user."""
    with get_session() as db_session:
        stmt = select(Series).order_by(Series.created_at.desc())
        rows = db_session.scalars(stmt).all()
        return jsonify({"series": [
            {
                "series_id": s.series_id,
                "name": s.name,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "key_columns": s.key_columns,
                "user_id": s.user_id,
            }
            for s in rows
        ]}), 200


@admin_bp.route("/datasets", methods=["GET"])
@admin_required
def list_all_datasets():
    """Every dataset (denormalised upload metadata) across every user."""
    with get_session() as db_session:
        stmt = select(Dataset).order_by(Dataset.upload_timestamp.desc())
        rows = db_session.scalars(stmt).all()
        return jsonify({"datasets": [
            {
                "dataset_id": d.dataset_id,
                "dataset_name": d.dataset_name,
                "original_file_name": d.original_file_name,
                "user_id": d.user_id,
                "upload_timestamp": d.upload_timestamp.isoformat() if d.upload_timestamp else None,
                "record_count": d.record_count,
                "file_type": d.file_type,
                "embedding_status": d.embedding_status,
            }
            for d in rows
        ]}), 200
