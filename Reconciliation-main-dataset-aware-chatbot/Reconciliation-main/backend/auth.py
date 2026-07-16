"""
Authentication helpers for the Reconciliation app.

Provides:
  - Password hashing / verification via Werkzeug's PBKDF2-SHA256
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
  - If Postgres is not reachable (db.is_available() == False), register
    and login return 503 with a clear message rather than crashing.
  - Usernames are stored and matched case-insensitively (lower-cased
    before insert and before lookup) to prevent duplicate accounts.
"""

import os
from datetime import timedelta
from functools import wraps

from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    decode_token,
    get_jwt_identity,
    jwt_required,
    verify_jwt_in_request,
)
from werkzeug.security import check_password_hash, generate_password_hash

import db

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
# Password helpers
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    """Return a PBKDF2-SHA256 hash of *plain* using Werkzeug's default
    parameters (600 000 iterations as of Werkzeug 3.x)."""
    return generate_password_hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return check_password_hash(hashed, plain)


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
# Auth Blueprint — /api/auth/register and /api/auth/login
# ---------------------------------------------------------------------------

auth_bp = Blueprint("auth", __name__)

_USERNAME_MIN = 3
_USERNAME_MAX = 50
_PASSWORD_MIN = 6


def _validate_credentials(username: str, password: str):
    """Basic server-side input validation. Returns an error string or None."""
    if not username or len(username) < _USERNAME_MIN:
        return f"Username must be at least {_USERNAME_MIN} characters."
    if len(username) > _USERNAME_MAX:
        return f"Username must be at most {_USERNAME_MAX} characters."
    if not password or len(password) < _PASSWORD_MIN:
        return f"Password must be at least {_PASSWORD_MIN} characters."
    return None


@auth_bp.route("/api/auth/register", methods=["POST"])
def register():
    """Register a new user.

    Request body (JSON):
        { "username": "alice", "password": "s3cr3t!" }

    Response 201:
        { "message": "Account created.", "access_token": "<jwt>" }

    Response 400: validation error
    Response 409: username already taken
    Response 503: database unavailable
    """
    if not db.is_available():
        return jsonify({"error": "Database is unavailable. Cannot register at this time."}), 503

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip().lower()
    password = (data.get("password") or "").strip()

    err = _validate_credentials(username, password)
    if err:
        return jsonify({"error": err}), 400

    password_hash = hash_password(password)
    user = db.create_user(username, password_hash)
    if user is None:
        return jsonify({"error": "Username is already taken. Please choose another."}), 409

    # Issue a token immediately so the client is logged in right after register.
    token = create_access_token(identity=str(user["id"]))
    return jsonify({
        "message": "Account created successfully.",
        "access_token": token,
        "user": {"id": user["id"], "username": user["username"]},
    }), 201


@auth_bp.route("/api/auth/login", methods=["POST"])
def login():
    """Authenticate an existing user and return a JWT.

    Request body (JSON):
        { "username": "alice", "password": "s3cr3t!" }

    Response 200:
        { "access_token": "<jwt>", "user": { "id": 1, "username": "alice" } }

    Response 400: missing fields
    Response 401: invalid credentials
    Response 503: database unavailable
    """
    if not db.is_available():
        return jsonify({"error": "Database is unavailable. Cannot log in at this time."}), 503

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not username or not password:
        return jsonify({"error": "Username and password are required."}), 400

    user = db.get_user_by_username(username)
    if user is None or not verify_password(password, user["password_hash"]):
        return jsonify({"error": "Invalid username or password."}), 401

    token = create_access_token(identity=str(user["id"]))
    return jsonify({
        "access_token": token,
        "user": {"id": user["id"], "username": user["username"]},
    }), 200


@auth_bp.route("/api/auth/me", methods=["GET"])
@require_auth
def me():
    """Return the currently authenticated user's profile.
    Used by the frontend to validate a stored token on page load."""
    user = db.get_user_by_id(g.current_user_id)
    if not user:
        return jsonify({"error": "User not found."}), 404
    return jsonify({"user": {"id": user["id"], "username": user["username"]}}), 200
