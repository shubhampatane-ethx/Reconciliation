"""
Session repository — all SQLAlchemy CRUD access to the `sessions`
table lives here, mirroring the pattern in user_repository.py.

Encapsulates:
  - Creating a new session (and deactivating any other active session
    for the same user — "single active session per user").
  - Looking sessions up by session_token / refresh_token.
  - Rotating a refresh token on use.
  - Touching last_activity on every authenticated request.
  - Enforcing the 30-minute idle timeout.
  - Deactivating a session on logout.
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from sqlalchemy import select, update

from database import get_session as get_db_session
from models import UserSession

REFRESH_TOKEN_LIFETIME_DAYS = 7
IDLE_TIMEOUT_MINUTES = 30


def _utcnow():
    return datetime.now(timezone.utc)


def _new_token() -> str:
    return secrets.token_hex(32)


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def create_session(user_id: int, ip_address: Optional[str] = None,
                    user_agent: Optional[str] = None) -> Dict:
    """Create a new active session for user_id, deactivating any other
    currently-active session for that user first (single active session
    per user — logging in elsewhere kicks out the previous session).

    Returns a dict with session_token, refresh_token, and expires_at,
    for embedding into the issued JWTs.
    """
    with get_db_session() as db:
        # Single active session: invalidate every other active session
        # this user currently has before creating the new one.
        db.execute(
            update(UserSession)
            .where(UserSession.user_id == user_id, UserSession.is_active.is_(True))
            .values(is_active=False)
        )

        now = _utcnow()
        sess = UserSession(
            user_id=user_id,
            session_token=_new_token(),
            refresh_token=_new_token(),
            created_at=now,
            expires_at=now + timedelta(days=REFRESH_TOKEN_LIFETIME_DAYS),
            last_activity=now,
            ip_address=ip_address,
            user_agent=(user_agent or "")[:512],
            is_active=True,
        )
        db.add(sess)
        db.flush()
        return {
            "id": sess.id,
            "session_token": sess.session_token,
            "refresh_token": sess.refresh_token,
            "expires_at": sess.expires_at,
        }


# ---------------------------------------------------------------------------
# Read / validate
# ---------------------------------------------------------------------------

def get_active_session_by_token(session_token: str) -> Optional[Dict]:
    """Fetch an active, non-expired, non-idle-timed-out session by its
    session_token (the "sid" claim carried in the access JWT).

    Returns None if the session doesn't exist, was superseded by a
    newer login, was logged out, has passed its absolute expiry, or has
    been idle for more than IDLE_TIMEOUT_MINUTES — any of which must
    result in the caller treating the request as unauthenticated.
    """
    with get_db_session() as db:
        stmt = select(UserSession).where(UserSession.session_token == session_token)
        sess = db.scalars(stmt).first()
        if sess is None or not sess.is_active:
            return None

        now = _utcnow()
        if sess.expires_at is not None and sess.expires_at < now:
            sess.is_active = False
            db.flush()
            return None

        idle_cutoff = sess.last_activity + timedelta(minutes=IDLE_TIMEOUT_MINUTES)
        if idle_cutoff < now:
            sess.is_active = False
            db.flush()
            return None

        return sess.to_dict()


def get_session_by_refresh_token(refresh_token: str) -> Optional[Dict]:
    """Fetch an active, non-expired session by refresh_token. Used by the
    /api/auth/refresh endpoint. Returns None if invalid/expired/inactive
    (expired refresh tokens can never be reused)."""
    with get_db_session() as db:
        stmt = select(UserSession).where(UserSession.refresh_token == refresh_token)
        sess = db.scalars(stmt).first()
        if sess is None or not sess.is_active:
            return None
        if sess.expires_at is not None and sess.expires_at < _utcnow():
            sess.is_active = False
            db.flush()
            return None
        return sess.to_dict()


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def touch_activity(session_token: str) -> None:
    """Update last_activity to now. Called on every authenticated request
    that passes validation, to keep the idle timeout accurate."""
    with get_db_session() as db:
        db.execute(
            update(UserSession)
            .where(UserSession.session_token == session_token, UserSession.is_active.is_(True))
            .values(last_activity=_utcnow())
        )


def rotate_refresh_token(session_id: int) -> Optional[str]:
    """Issue a fresh refresh_token for an existing session (refresh
    token rotation) and return it. The old refresh token stops working
    immediately since the column is overwritten."""
    with get_db_session() as db:
        sess = db.get(UserSession, session_id)
        if sess is None or not sess.is_active:
            return None
        sess.refresh_token = _new_token()
        sess.last_activity = _utcnow()
        db.flush()
        return sess.refresh_token


def deactivate_session(session_token: str) -> bool:
    """Logout: deactivate a session by its session_token. Once inactive,
    neither its access token's "sid" nor its refresh_token can be used
    again."""
    with get_db_session() as db:
        result = db.execute(
            update(UserSession)
            .where(UserSession.session_token == session_token, UserSession.is_active.is_(True))
            .values(is_active=False)
        )
        return result.rowcount > 0


def deactivate_all_for_user(user_id: int) -> int:
    """Deactivate every active session for a user (e.g. admin force-logout,
    or password change). Returns the number of sessions deactivated."""
    with get_db_session() as db:
        result = db.execute(
            update(UserSession)
            .where(UserSession.user_id == user_id, UserSession.is_active.is_(True))
            .values(is_active=False)
        )
        return result.rowcount
