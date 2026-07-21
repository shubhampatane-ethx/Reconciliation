"""
Authentication helpers for the Reconciliation app.

Provides:
  - Password hashing / verification via bcrypt
  - JWT creation / decoding via Flask-JWT-Extended
  - A decorator  @require_auth  that protects any Flask route:
      * Reads the Bearer token from the Authorization header
      * Validates it, and injects  g.current_user_id (int)  into the
        request context so downstream route handlers can scope queries
        to the authenticated user without knowing about JWT internals.
  - Blueprint  auth_bp  with  /api/auth/register  and  /api/auth/login
    routes, registered in app.py with app.register_blueprint(auth_bp).

Design decisions:
  - Stateless JWT (no server-side session store). The token carries the
    user's numeric `id` as the "sub" claim.
  - Token lifetime is controlled by JWT_ACCESS_TOKEN_EXPIRES (env var),
    defaulting to 24 hours.
  - Users are identified by email (case-insensitive) rather than a
    separate username. Registration also collects a full_name.
  - User persistence (create/read/update/delete) goes through
    repositories/user_repository.py, which uses the SQLAlchemy `User`
    model defined in models.py. The `users` table itself is created
    and migrated exclusively via Alembic (see backend/alembic/) — this
    module never creates tables.
  - If Postgres is not reachable, register and login return 503 with a
    clear message rather than crashing.
"""

import os
import re
from datetime import timedelta
from functools import wraps

import bcrypt
from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    get_jwt_identity,
    jwt_required,
    verify_jwt_in_request,
)

import database
from repositories import user_repository

# ---------------------------------------------------------------------------
# JWT configuration helpers — called from app.py
# ---------------------------------------------------------------------------

JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production-use-a-long-random-string")
JWT_EXPIRES_HOURS = int(os.environ.get("JWT_ACCESS_TOKEN_EXPIRES_HOURS", "24"))


def configure_jwt(app):
    """Apply JWT settings to the Flask app and return the JWTManager.
    Call this once from app.py after creating the Flask instance."""
    app.config["JWT_SECRET_KEY"] = JWT_SECRET
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=JWT_EXPIRES_HOURS)
    return JWTManager(app)


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
# Route decorator — @require_auth
# ---------------------------------------------------------------------------

def require_auth(f):
    """Decorator that enforces a valid JWT Bearer token on any route.

    On success: sets  g.current_user_id  to the authenticated user's
    integer primary-key id and calls the wrapped route function normally.

    On failure: returns 401 JSON without calling the route at all.

    Usage:
        @app.route('/api/series', methods=['GET'])
        @require_auth
        def series_list():
            user_id = g.current_user_id
            ...
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            verify_jwt_in_request()
            identity = get_jwt_identity()
            g.current_user_id = int(identity)
        except Exception:
            return jsonify({"error": "Authentication required. Please log in."}), 401
        return f(*args, **kwargs)
    return wrapper


def optional_auth(f):
    """Like require_auth but does NOT reject unauthenticated requests.
    Sets g.current_user_id to None when no (valid) token is present.
    Useful for routes that work both authenticated and anonymously."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            verify_jwt_in_request(optional=True)
            identity = get_jwt_identity()
            g.current_user_id = int(identity) if identity is not None else None
        except Exception:
            g.current_user_id = None
        return f(*args, **kwargs)
    return wrapper


# ---------------------------------------------------------------------------
# Auth Blueprint — /api/auth/register, /api/auth/login, /api/auth/me
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


@auth_bp.route("/api/auth/register", methods=["POST"])
def register():
    """Register a new user.

    Request body (JSON):
        { "full_name": "Alice Smith", "email": "alice@example.com", "password": "s3cr3t!" }

    Response 201:
        { "message": "Account created.", "access_token": "<jwt>", "user": {...} }

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

    password_hash = hash_password(password)
    user = user_repository.create_user(full_name, email, password_hash)
    if user is None:
        return jsonify({"error": "An account with this email already exists."}), 409

    # Issue a token immediately so the client is logged in right after register.
    token = create_access_token(identity=str(user["id"]))
    return jsonify({
        "message": "Account created successfully.",
        "access_token": token,
        "user": user,
    }), 201


@auth_bp.route("/api/auth/login", methods=["POST"])
def login():
    """Authenticate an existing user and return a JWT.

    Request body (JSON):
        { "email": "alice@example.com", "password": "s3cr3t!" }

    Response 200:
        { "access_token": "<jwt>", "user": { "id": 1, "email": "...", ... } }

    Response 400: missing fields
    Response 401: invalid credentials, or account deactivated
    Response 503: database unavailable
    """
    if not database.is_available():
        return jsonify({"error": "Database is unavailable. Cannot log in at this time."}), 503

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    user = user_repository.get_user_by_email(email, include_sensitive=True)
    if user is None or not verify_password(password, user["password_hash"]):
        return jsonify({"error": "Invalid email or password."}), 401

    if not user.get("is_active", True):
        return jsonify({"error": "This account has been deactivated."}), 401

    updated = user_repository.update_last_login(user["id"])

    token = create_access_token(identity=str(user["id"]))
    return jsonify({
        "access_token": token,
        "user": updated or user_repository.get_user_by_id(user["id"]),
    }), 200


@auth_bp.route("/api/auth/me", methods=["GET"])
@require_auth
def me():
    """Return the currently authenticated user's profile.
    Used by the frontend to validate a stored token on page load."""
    user = user_repository.get_user_by_id(g.current_user_id)
    if not user:
        return jsonify({"error": "User not found."}), 404
    return jsonify({"user": user}), 200
