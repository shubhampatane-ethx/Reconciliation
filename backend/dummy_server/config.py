"""
=====================================================================
 DUMMY SERVER  ->  config.py
=====================================================================
Centralised configuration for the Dummy Server, loaded from
environment variables (via backend/.env).
=====================================================================
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env regardless of which directory uvicorn is started from.
# Path(__file__) = backend/dummy_server/config.py  →  parent.parent = backend/
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=_env_path, override=False)

# ---------------------------------------------------------------------------
# Database connection — points at the user's own Target_Data database.
# DUMMY_SERVER_DATABASE_URL takes priority; falls back to the shared
# consistency DB only if not set (keeps existing behaviour for anyone
# who hasn't set the new variable yet).
# ---------------------------------------------------------------------------
DATABASE_URL = os.environ.get(
    "DUMMY_SERVER_DATABASE_URL",
    os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:Swamiom%401702%23@localhost:5432/Target_Data",
    ),
)

# ---------------------------------------------------------------------------
# Server binding — port 9000 so it doesn't clash with Flask (5000)
# ---------------------------------------------------------------------------
HOST = os.environ.get("DUMMY_SERVER_HOST", "0.0.0.0")
PORT = int(os.environ.get("DUMMY_SERVER_PORT", "9000"))
