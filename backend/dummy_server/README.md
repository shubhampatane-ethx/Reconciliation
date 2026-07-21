# Dummy Server (Phase 1)

A **completely independent** FastAPI application that simulates an
external enterprise system (ERP / SAP / Oracle / Salesforce / any
REST API). It knows nothing about reconciliation — it only reads
"target" rows from Postgres and returns them as JSON.

```
dummy_server/
    app.py                 FastAPI app entrypoint (port 9000)
    config.py               env-based configuration
    database.py              SQLAlchemy engine/session
    models.py                 target_data ORM model (generic JSONB row_data)
    schemas.py                 Pydantic response models
    api/target.py               GET /target-data endpoint
    services/target_service.py   query logic
    seed_sample_data.py            optional: inserts sample rows for testing
    requirements.txt
    .env.example
```

## Run it with Docker Compose (recommended — matches your existing project)

From the project root:

```bash
docker compose up --build
```

This starts 4 containers: `db` (Postgres, unchanged), `backend` (existing
Flask app, unchanged), `frontend` (unchanged), and the new `dummy_server`
container (port 9000). See the "PHASE 1 ADDITION" block in
`docker-compose.yml` — it's the only new service, plus one new
`DUMMY_SERVER_BASE_URL` env var added to the existing `backend` service so
it can reach `dummy_server` by container name instead of `localhost`.

To seed sample target data once the containers are up:
```bash
docker compose exec dummy_server python -m dummy_server.seed_sample_data
```

## Run it without Docker

Run these from the **`backend/`** directory (one level up from here), so
`dummy_server` resolves as a Python package:

```bash
cd backend
pip install -r dummy_server/requirements.txt
cp dummy_server/.env.example dummy_server/.env   # adjust DUMMY_SERVER_DATABASE_URL if needed

# (optional, first time only) put some sample target rows in the DB:
python -m dummy_server.seed_sample_data

uvicorn dummy_server.app:app --host 0.0.0.0 --port 9000 --reload
```

Docs: http://localhost:9000/docs
Health check: http://localhost:9000/health

## Endpoint

```
GET /target-data[?project_name=...&entity_name=...]

{
  "total_records": 3,
  "data": [
    {
      "id": 1,
      "project_name": "default_project",
      "entity_name": "customer",
      "business_key": "CustomerID",
      "updated_at": "2026-07-16T12:00:00Z",
      "row_data": {"CustomerID": 101, "Name": "Amit", "City": "Pune", "Balance": 5000}
    }
  ]
}
```

## Later

To swap this for a real external system, replace the contents of
`services/target_service.py` (and, if needed, `database.py`) with a
real API/DB client. `api/target.py` and the response shape can stay
exactly the same, so the main backend's integration doesn't need to
change.
