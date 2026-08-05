"""
=====================================================================
 DUMMY SERVER  ->  app.py   (FastAPI application entrypoint)
=====================================================================
NEW FILE — Phase 1 addition. This is the "external enterprise system"
simulator described in the requirements. It is a COMPLETELY SEPARATE
FastAPI application/process from the existing Flask reconciliation
backend (backend/app.py) — the two do not import from each other and
can be started, stopped, and deployed independently.

    Existing Flask backend  -> backend/app.py         -> port 5000
    NEW Dummy Server        -> backend/dummy_server/app.py -> port 9000

Responsibility (and ONLY responsibility) of this service, per spec:
    - Connect to PostgreSQL
    - Read target data
    - Return it as JSON

It intentionally does NOT do reconciliation, comparison, or reporting
— that logic stays exactly where it already lives in the main backend.

---------------------------------------------------------------------
HOW TO RUN (separately from the existing backend):

    cd backend
    pip install -r dummy_server/requirements.txt
    uvicorn dummy_server.app:app --host 0.0.0.0 --port 9000 --reload

Interactive API docs will then be available at:
    http://localhost:9000/docs
---------------------------------------------------------------------
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dummy_server.api import target
from dummy_server.database import engine  # noqa: F401 — imported to validate DB URL on startup

# NOTE: We do NOT call Base.metadata.create_all() here.
# The target table (cjbs_target_table) already exists in the user's
# Target_Data database — we only READ from it, never create or migrate it.

app = FastAPI(
    title="Dummy Server (External System Simulator)",
    description=(
        "Standalone service that simulates an external enterprise system "
        "(ERP / SAP / Oracle / Salesforce / any REST API). Reads target "
        "data from Postgres and returns it as JSON. Phase 1 of the "
        "Reconciliation project's automated-target-fetch feature."
    ),
    version="1.0.0",
)

# Permissive CORS for local development so the main backend (and, if
# ever needed, the frontend) can call this service without friction.
# Tighten this before any real production deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the /target-data endpoint defined in api/target.py.
app.include_router(target.router)


@app.get("/health")
def health_check():
    """Simple liveness check, handy for docker-compose healthchecks later."""
    return {"status": "ok", "service": "dummy-server"}
