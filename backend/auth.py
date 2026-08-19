"""
Authentication, authorization, and session management for the
Reconciliation app.

Provides:
  - Password hashing / verification via bcrypt.
  - JWT access + refresh tokens via Flask-JWT-Extended, backed by a
    server-side `sessions` table (see models.UserSession /
    repositories/session_repository.py) so tokens can actually be
    revoked (logout, single-active-session eviction, idle timeout) —
    a stateless-only JWT can't do that.
  - A permanent hardcoded Global Admin account, auto-created on
    startup if missing (ensure_admin_bootstrap). No signup/registration
    path for it; it always logs in through the normal /api/auth/login
    route like any other account.
  - Role-based access control. Authorization is always decided via
    `g.current_user_role == "ADMIN"` (backed by users.role) — never by
    comparing email addresses.
  - Route decorators:
      @login_required   Any authenticated user (replaces require_auth).
      @admin_required    Authenticated AND role == ADMIN.
      @optional_auth      Unchanged: never rejects, just may leave
                           g.current_user_id as None.
    All three verify, in order: JWT signature/expiry -> session_token
    still active in the sessions table -> idle timeout -> role (for
    @admin_required). Ownership (`object.user_id == current_user.id`)
    is still checked per-route since it depends on the model being
    fetched, but g.is_admin is exposed so routes can let admins bypass
    it in one line: `if not (g.is_admin or owner == user_id): 403`.
  - require_auth is kept as an alias of login_required so existing
    route registrations (`from auth import require_auth`) keep working
    unchanged.

Design decisions:
  - Access token: 15 minutes. Carries `sub` (user id) and `sid`
    (this session's session_token) claims.
  - Refresh token: 7 days, opaque (not a JWT) — stored in and only
    ever compared against the sessions table, and rotated (replaced)
    every time it's used, so a leaked-and-reused old refresh token is
    rejected outright.
  - Only ONE active session per user: a new login deactivates any
    session that user already had. Deactivating a session invalidates
    its access token's `sid` and its refresh token immediately, even
    though the JWT signature itself would otherwise still verify.
  - 30 minutes of inactivity on a session expires it; every
    successfully-authenticated request touches last_activity.
  - Login is rate-limited per (ip, email) to blunt credential
    stuffing / brute force.
  - Users are identified by email (case-insensitive). Registration
    always creates role=USER; nothing in the public API can create or
    escalate to ADMIN.
  - User persistence goes through repositories/user_repository.py;
    session persistence through repositories/session_repository.py.
    Both use the SQLAlchemy models in models.py. Table DDL is owned
    exclusively by Alembic (backend/alembic/) — this module never
    creates tables.
  - If Postgres is not reachable, auth routes return 503 rather than
    crashing.
"""

import os
import re
import time
from collections import defaultdict, deque
from datetime import timedelta
from functools import wraps

import bcrypt
from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
    verify_jwt_in_request,
)

import database
from models import User
from repositories import session_repository, user_repository

# ---------------------------------------------------------------------------
# JWT configuration helpers — called from app.py
# ---------------------------------------------------------------------------

JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production-use-a-long-random-string")
ACCESS_TOKEN_MINUTES = int(os.environ.get("JWT_ACCESS_TOKEN_EXPIRES_MINUTES", "15"))
REFRESH_TOKEN_DAYS = session_repository.REFRESH_TOKEN_LIFETIME_DAYS


def configure_jwt(app):
    """Apply JWT settings to the Flask app and return the JWTManager.
    Call this once from app.py after creating the Flask instance."""
    app.config["JWT_SECRET_KEY"] = JWT_SECRET
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(minutes=ACCESS_TOKEN_MINUTES)
    return JWTManager(app)


# ---------------------------------------------------------------------------
# Hardcoded Global Admin bootstrap
# ---------------------------------------------------------------------------

ADMIN_EMAIL = "admin@gmail.com"
ADMIN_PASSWORD = "admin@1234"
ADMIN_FULL_NAME = "Administrator"


def ensure_admin_bootstrap():
    """Idempotently create the permanent Global Admin account on startup.

    Call once from app.py at import/startup time (after configure_jwt).
    Safe to call on every restart: if the account already exists this
    is a no-op; it is never re-created or duplicated. There is no
    signup/registration path for this account — it only ever exists
    via this bootstrap and logs in through the normal /api/auth/login
    route.
    """
    if not database.is_available():
        # Postgres not reachable at startup (e.g. local dev without
        # Docker yet) — skip silently, same failure mode as the rest
        # of the app's DB-dependent startup steps. A later restart
        # (or the app once Postgres comes up) will create it.
        return

    existing = user_repository.get_user_by_email(ADMIN_EMAIL)
    if existing is not None:
        # Already present. Make sure it's still an admin and active —
        # never duplicate it, but also don't silently leave a broken
        # admin account around if role/is_active drifted.
        if existing.get("role") != User.ROLE_ADMIN or not existing.get("is_active", True):
            user_repository.update_user(existing["id"], role=User.ROLE_ADMIN, is_active=True)
        return

    user_repository.create_user(
        full_name=ADMIN_FULL_NAME,
        email=ADMIN_EMAIL,
        password_hash=hash_password(ADMIN_PASSWORD),
        role=User.ROLE_ADMIN,
    )


# ---------------------------------------------------------------------------
# Password helpers — bcrypt
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    """Return a bcrypt hash of *plain*. Passwords are NEVER stored as
    plain text — only this hash is persisted."""
    hashed = bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, AttributeError):
        # Malformed/legacy hash — treat as a failed verification rather
        # than crashing the request.
        return False


# ---------------------------------------------------------------------------
# Token issuing helpers
# ---------------------------------------------------------------------------

def _issue_tokens(user_id: int):
    """Create a new session row (evicting any other active session for
    this user) and return (access_token, refresh_token, session)."""
    sess = session_repository.create_session(
        user_id=user_id,
        ip_address=(request.headers.get("X-Forwarded-For", request.remote_addr) or "")[:64],
        user_agent=request.headers.get("User-Agent", ""),
    )
    access_token = create_access_token(
        identity=str(user_id),
        additional_claims={"sid": sess["session_token"]},
    )
    return access_token, sess["refresh_token"], sess


# ---------------------------------------------------------------------------
# Login rate limiting (in-memory, per process)
# ---------------------------------------------------------------------------
# A dependency-free sliding-window limiter keyed on (ip, email). This is
# per-process, so it resets on restart and isn't shared across multiple
# gunicorn workers/replicas — good enough to blunt naive credential
# stuffing without adding infra (Redis) the rest of the app doesn't use.

_LOGIN_WINDOW_SECONDS = 15 * 60
_LOGIN_MAX_ATTEMPTS = 10
_login_attempts = defaultdict(deque)


def _login_rate_limited(key: str) -> bool:
    now = time.time()
    attempts = _login_attempts[key]
    while attempts and now - attempts[0] > _LOGIN_WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= _LOGIN_MAX_ATTEMPTS:
        return True
    attempts.append(now)
    return False


def _record_login_success(key: str) -> None:
    # Clear the counter on a successful login so a legitimate user who
    # mistyped their password a few times isn't punished afterwards.
    _login_attempts.pop(key, None)


# ---------------------------------------------------------------------------
# Route decorators — @login_required / @admin_required / @optional_auth
# ---------------------------------------------------------------------------

def _load_authenticated_context():
    """Verify the JWT, then verify its session is still active
    (not logged out / evicted by a newer login / idle-timed-out /
    past its absolute expiry). Raises on any failure. On success,
    populates g.current_user_id, g.current_user_role, g.is_admin,
    g.session_token.
    """
    verify_jwt_in_request()
    identity = get_jwt_identity()
    claims = get_jwt()
    session_token = claims.get("sid")

    if not session_token:
        raise ValueError("Token missing session claim.")

    sess = session_repository.get_active_session_by_token(session_token)
    if sess is None:
        raise ValueError("Session expired, logged out, or superseded by a newer login.")

    user = user_repository.get_user_by_id(int(identity))
    if user is None or not user.get("is_active", True):
        raise ValueError("User not found or deactivated.")

    session_repository.touch_activity(session_token)

    g.current_user_id = int(identity)
    g.current_user_role = user.get("role", User.ROLE_USER)
    g.is_admin = g.current_user_role == User.ROLE_ADMIN
    g.session_token = session_token


def login_required(f):
    """Decorator that enforces a valid access token AND a still-active
    server-side session on any route.

    On success: sets g.current_user_id (int), g.current_user_role
    ("ADMIN"/"USER"), g.is_admin (bool), g.session_token, and calls the
    wrapped route function normally.

    On failure: returns 401 JSON without calling the route at all.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            _load_authenticated_context()
        except Exception:
            return jsonify({"error": "Authentication required. Please log in."}), 401
        return f(*args, **kwargs)
    return wrapper


# Kept as an alias so existing `from auth import require_auth` imports
# and route registrations across the codebase keep working unchanged.
require_auth = login_required


def admin_required(f):
    """Decorator that enforces login_required AND role == ADMIN.
    Returns 401 if unauthenticated, 403 if authenticated but not an
    admin."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            _load_authenticated_context()
        except Exception:
            return jsonify({"error": "Authentication required. Please log in."}), 401
        if not g.is_admin:
            return jsonify({"error": "Admin privileges required."}), 403
        return f(*args, **kwargs)
    return wrapper


def optional_auth(f):
    """Like login_required but does NOT reject unauthenticated requests.
    Sets g.current_user_id / g.current_user_role / g.is_admin to None
    /None/False when no (valid, active) session is present. Useful for
    routes that work both authenticated and anonymously."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            verify_jwt_in_request(optional=True)
            identity = get_jwt_identity()
            if identity is None:
                raise ValueError("No token.")
            _load_authenticated_context()
        except Exception:
            g.current_user_id = None
            g.current_user_role = None
            g.is_admin = False
            g.session_token = None
        return f(*args, **kwargs)
    return wrapper


# ---------------------------------------------------------------------------
# Auth Blueprint
# ---------------------------------------------------------------------------

auth_bp = Blueprint("auth", __name__)

_FULL_NAME_MIN = 2
_FULL_NAME_MAX = 255
_PASSWORD_MIN = 6
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_registration(full_name: str, email: str, password: str):
    """Basic server-side input validation. Returns an error string or None."""
    if not full_name or len(full_name) < _FULL_NAME_MIN:
        return f"Full name must be at least {_FULL_NAME_MIN} characters."
    if len(full_name) > _FULL_NAME_MAX:
        return f"Full name must be at most {_FULL_NAME_MAX} characters."
    if not email or not _EMAIL_RE.match(email):
        return "A valid email address is required."
    if not password or len(password) < _PASSWORD_MIN:
        return f"Password must be at least {_PASSWORD_MIN} characters."
    return None


@auth_bp.route("/api/auth/register", methods=["POST", "OPTIONS"])
@auth_bp.route("/api/auth/registerRequest", methods=["POST", "OPTIONS"])
def register():
    """Register a new user. Always created with role=USER — there is no
    way to self-register as ADMIN; the only admin account is the
    hardcoded, auto-bootstrapped one (see ensure_admin_bootstrap).

    Request body (JSON):
        { "full_name": "Alice Smith", "email": "alice@example.com", "password": "s3cr3t!" }

    Response 201:
        { "message": "...", "access_token": "<jwt>", "refresh_token": "<token>", "user": {...} }

    Response 400: validation error
    Response 409: email already registered
    Response 503: database unavailable
    """
    if not database.is_available():
        return jsonify({"error": "Database is unavailable. Cannot register at this time."}), 503

    data = request.get_json(silent=True) or {}
    full_name = (data.get("full_name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()

    err = _validate_registration(full_name, email, password)
    if err:
        return jsonify({"error": err}), 400

    if email == ADMIN_EMAIL:
        # The admin address is reserved for the hardcoded bootstrap
        # account and can never be (re-)registered through signup.
        return jsonify({"error": "This email address is reserved."}), 409

    password_hash = hash_password(password)
    user = user_repository.create_user(full_name, email, password_hash, role=User.ROLE_USER)
    if user is None:
        return jsonify({"error": "An account with this email already exists."}), 409

    access_token, refresh_token, _sess = _issue_tokens(user["id"])
    return jsonify({
        "message": "Account created successfully.",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": user,
    }), 201


@auth_bp.route("/api/auth/login", methods=["POST", "OPTIONS"])
@auth_bp.route("/api/auth/loginRequest", methods=["POST", "OPTIONS"])
def login():
    """Authenticate an existing user (including the hardcoded admin
    account) and return an access + refresh token pair. Logging in
    deactivates any other session this user already has open elsewhere
    (single active session per user).

    Request body (JSON):
        { "email": "alice@example.com", "password": "s3cr3t!" }

    Response 200:
        { "access_token": "<jwt>", "refresh_token": "<token>", "user": {...} }

    Response 400: missing fields
    Response 401: invalid credentials, or account deactivated
    Response 429: too many attempts — try again later
    Response 503: database unavailable
    """
    if not database.is_available():
        return jsonify({"error": "Database is unavailable. Cannot log in at this time."}), 503

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    client_ip = (request.headers.get("X-Forwarded-For", request.remote_addr) or "unknown")[:64]
    rate_key = f"{client_ip}:{email}"
    if _login_rate_limited(rate_key):
        return jsonify({"error": "Too many login attempts. Please try again later."}), 429

    user = user_repository.get_user_by_email(email, include_sensitive=True)
    if user is None or not verify_password(password, user["password_hash"]):
        return jsonify({"error": "Invalid email or password."}), 401

    if not user.get("is_active", True):
        return jsonify({"error": "This account has been deactivated."}), 401

    _record_login_success(rate_key)
    updated = user_repository.update_last_login(user["id"])
    access_token, refresh_token, _sess = _issue_tokens(user["id"])

    return jsonify({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": updated or user_repository.get_user_by_id(user["id"]),
    }), 200


@auth_bp.route("/api/auth/refresh", methods=["POST"])
def refresh():
    """Exchange a still-valid refresh token for a new access token
    (and a rotated refresh token — the old one stops working the
    moment this succeeds, so a leaked-and-reused old refresh token is
    rejected). Also re-validates that the underlying session hasn't
    been logged out, superseded, idle-timed-out, or expired.

    Request body (JSON): { "refresh_token": "<token>" }

    Response 200: { "access_token": "<jwt>", "refresh_token": "<new token>" }
    Response 401: missing/invalid/expired/revoked refresh token
    Response 503: database unavailable
    """
    if not database.is_available():
        return jsonify({"error": "Database is unavailable."}), 503

    data = request.get_json(silent=True) or {}
    refresh_token = (data.get("refresh_token") or "").strip()
    if not refresh_token:
        return jsonify({"error": "refresh_token is required."}), 400

    sess = session_repository.get_session_by_refresh_token(refresh_token)
    if sess is None:
        return jsonify({"error": "Refresh token is invalid, expired, or has been revoked."}), 401

    user = user_repository.get_user_by_id(sess["user_id"])
    if user is None or not user.get("is_active", True):
        return jsonify({"error": "User not found or deactivated."}), 401

    new_refresh_token = session_repository.rotate_refresh_token(sess["id"])
    if new_refresh_token is None:
        return jsonify({"error": "Session is no longer active."}), 401

    access_token = create_access_token(
        identity=str(user["id"]),
        additional_claims={"sid": sess["session_token"]},
    )
    return jsonify({"access_token": access_token, "refresh_token": new_refresh_token}), 200


@auth_bp.route("/api/auth/logout", methods=["POST"])
@login_required
def logout():
    """Deactivate the caller's current session: its access token's
    session claim and its refresh token both become unusable
    immediately, even though the JWT signature would otherwise still
    verify until natural expiry."""
    session_repository.deactivate_session(g.session_token)
    return jsonify({"message": "Logged out."}), 200


@auth_bp.route("/api/auth/me", methods=["GET"])
@login_required
def me():
    """Return the currently authenticated user's profile.
    Used by the frontend to validate a stored token on page load."""
    user = user_repository.get_user_by_id(g.current_user_id)
    if not user:
        return jsonify({"error": "User not found."}), 404
    return jsonify({"user": user}), 200
