"""
User repository — all SQLAlchemy CRUD access to the `users` table
lives here so route/service code never touches sessions or the ORM
model directly.

Every function opens and closes its own session via database.get_session()
and returns plain dicts (via User.to_dict()) rather than detached ORM
instances, so callers don't need to worry about session lifetimes.
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from database import get_session
from models import User


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def create_user(full_name: str, email: str, password_hash: str) -> Optional[Dict]:
    """Insert a new user. Returns the created user dict, or None if the
    email is already registered (unique constraint violation)."""
    email = email.strip().lower()
    try:
        with get_session() as session:
            user = User(full_name=full_name.strip(), email=email, password_hash=password_hash)
            session.add(user)
            session.flush()  # populate user.id / defaults before serializing
            return user.to_dict()
    except IntegrityError:
        return None


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

def get_user_by_id(user_id: int, include_sensitive: bool = False) -> Optional[Dict]:
    with get_session() as session:
        user = session.get(User, user_id)
        return user.to_dict(include_sensitive=include_sensitive) if user else None


def get_user_by_email(email: str, include_sensitive: bool = False) -> Optional[Dict]:
    """Look up a user by (case-insensitive) email. include_sensitive=True
    returns the password_hash too — only the login flow should set this."""
    email = (email or "").strip().lower()
    with get_session() as session:
        stmt = select(User).where(User.email == email)
        user = session.scalars(stmt).first()
        return user.to_dict(include_sensitive=include_sensitive) if user else None


def list_users(only_active: bool = False) -> List[Dict]:
    with get_session() as session:
        stmt = select(User).order_by(User.created_at.desc())
        if only_active:
            stmt = stmt.where(User.is_active.is_(True))
        users = session.scalars(stmt).all()
        return [u.to_dict() for u in users]


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def update_user(user_id: int, **fields) -> Optional[Dict]:
    """Generic partial update. Only whitelisted columns may be updated.

    Example: update_user(3, full_name="New Name", is_active=False)
    """
    allowed = {"full_name", "email", "password_hash", "is_active"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return get_user_by_id(user_id)

    if "email" in updates:
        updates["email"] = updates["email"].strip().lower()

    with get_session() as session:
        user = session.get(User, user_id)
        if user is None:
            return None
        for key, value in updates.items():
            setattr(user, key, value)
        session.flush()
        return user.to_dict()


def update_last_login(user_id: int) -> Optional[Dict]:
    """Set last_login to the current UTC time. Called on every successful login."""
    with get_session() as session:
        user = session.get(User, user_id)
        if user is None:
            return None
        user.last_login = datetime.now(timezone.utc)
        session.flush()
        return user.to_dict()


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def delete_user(user_id: int) -> bool:
    """Hard-delete a user. Returns True if a row was deleted."""
    with get_session() as session:
        user = session.get(User, user_id)
        if user is None:
            return False
        session.delete(user)
        return True


def deactivate_user(user_id: int) -> Optional[Dict]:
    """Soft-delete: flips is_active to False instead of removing the row."""
    return update_user(user_id, is_active=False)
