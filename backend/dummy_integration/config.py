"""
=====================================================================
 dummy_integration  ->  config.py
=====================================================================
Configuration for the dummy_integration module: where the Dummy
Server lives, and which Postgres database to stage source rows into.
=====================================================================
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env regardless of which directory Flask is started from.
# Path(__file__) = backend/dummy_integration/config.py → parent.parent = backend/
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=_env_path, override=False)

# Base URL of the independent Dummy Server (backend/dummy_server/app.py),
# which runs on port 9000 by default.
DUMMY_SERVER_BASE_URL = os.environ.get(
    "DUMMY_SERVER_BASE_URL", "http://localhost:9000"
)

# Source staging uses the main consistency DB (same as the rest of the Flask app).
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:Swamiom%401702%23@localhost:5432/Target_Data",
)

# How long (seconds) to wait for the Dummy Server before giving up.
DUMMY_SERVER_TIMEOUT_SECONDS = int(os.environ.get("DUMMY_SERVER_TIMEOUT_SECONDS", "10"))
# "postgresql://consistency:consistency@localhost:5432/consistency"
