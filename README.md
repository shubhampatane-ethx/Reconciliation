# Reconciliation App

A full-stack web application for **schema-agnostic data reconciliation**. It automatically detects whether uploaded files contain Master Data or Transactional Data, maps columns intelligently across differing schemas, and produces a detailed reconciliation dashboard with financial summaries and audit logs.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Getting Started](#getting-started)
5. [Environment Variables](#environment-variables)
6. [Services](#services)
   - [Backend (Flask)](#backend-flask)
   - [Frontend (React + Vite)](#frontend-react--vite)
   - [Dummy Server (FastAPI)](#dummy-server-fastapi)
7. [Core Features](#core-features)
   - [Dynamic Column Mapper](#dynamic-column-mapper)
   - [Auto File-Type Detection](#auto-file-type-detection)
   - [AR Reconciliation Engine](#ar-reconciliation-engine)
   - [Master Data Reconciliation](#master-data-reconciliation)
   - [AI Chat Assistant](#ai-chat-assistant)
   - [Vector Database & Semantic Analysis](#vector-database--semantic-analysis)
   - [EDA Modal](#eda-modal)
8. [API Reference](#api-reference)
9. [Database](#database)
10. [Authentication](#authentication)
11. [Changelog](#changelog)

---

## Architecture Overview

```
Browser (React)
     │
     ▼
Vite Dev Server / Nginx  ──proxy /api/*──►  Flask Backend (port 5000)
                                                │
                              ┌─────────────────┼─────────────────┐
                              ▼                 ▼                 ▼
                         PostgreSQL       vector_store/      Dummy Server
                         (port 5432)     (filesystem)       FastAPI (port 9000)
                              │
                         target_db
                         (port 5433)
```

- **Flask backend** handles all business logic: reconciliation, file upload, AI chat, auth, admin.
- **PostgreSQL (`db`)** stores users, sessions, series metadata, and row snapshot history.
- **`vector_store/`** (filesystem) stores uploaded file chunks and per-run JSON/Excel reports.
- **Dummy Server** simulates an external enterprise system (ERP/SAP/Oracle) and serves target data over HTTP for integration testing.
- **`target_db`** is a separate Postgres instance used exclusively by the dummy server (host port 5433).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Axios |
| Backend | Python 3, Flask, SQLAlchemy, Alembic, pandas, scikit-learn |
| Database | PostgreSQL 16 |
| AI — Primary | Groq API (OpenAI-compatible, hosted) |
| AI — Fallback | Ollama (local LLM) |
| Container | Docker, Docker Compose |
| Auth | JWT (Flask-JWT-Extended) |
| Dummy Server | FastAPI, Uvicorn |

---

## Project Structure

```
Reconciliation/
├── docker-compose.yml           # Orchestrates all services
├── .env                         # Root env vars (GROQ_API_KEY, OLLAMA_BASE_URL, etc.)
├── .env.example
├── column_mapper.py             # Reference implementation (basis for ar_column_mapper.py)
├── reconcile_v2.py              # Reference implementation (basis for ar_reconcile.py)
│
├── backend/
│   ├── app.py                   # Flask app — all API endpoints
│   ├── auth.py                  # JWT auth helpers + /api/auth/* routes
│   ├── admin_routes.py          # Admin-only endpoints (/api/admin/*)
│   ├── database.py              # Lazy SQLAlchemy engine + session factory
│   ├── db.py                    # Higher-level DB helpers (series, snapshots, history)
│   ├── models.py                # SQLAlchemy ORM models
│   ├── storage.py               # File/report I/O + vector_store filesystem ops
│   ├── fuzzy_match.py           # TF-IDF + cosine similarity rename detection
│   ├── insights.py              # NLP narrative + KMeans clustering for day-wise reports
│   ├── normalize.py             # Value normalisation helpers
│   ├── schema_engine.py         # Schema mapping analysis
│   ├── row_reconcile_engine.py  # Row-level reconciliation by index/key
│   ├── daily_tracker.py         # Day-by-day version tracking helpers
│   ├── groq_service.py          # Groq AI client (primary chat provider)
│   ├── ollama_service.py        # Ollama AI client (fallback chat provider)
│   ├── ar_synonyms.json         # External synonym dictionary (canonical field names)
│   ├── ar_column_mapper.py      # Schema-agnostic column mapper (3-tier resolution)
│   ├── ar_reconcile.py          # AR reconciliation engine (Tier-1 + Tier-2 matching)
│   ├── ar_chunked_read.py       # Chunked file reading for large uploads
│   ├── ar_pagination.py         # Pagination helpers for AR result sets
│   ├── entrypoint.sh            # Docker entrypoint — runs Alembic then Flask
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── alembic.ini
│   ├── alembic/
│   │   └── versions/            # Migration scripts (0001 → 0004)
│   ├── repositories/
│   │   ├── session_repository.py
│   │   └── user_repository.py
│   ├── vector_store/            # Runtime data (gitignored)
│   │   ├── *.json               # Uploaded file chunk documents
│   │   └── reports/             # Per-series diff JSON + Excel reports
│   └── dummy_integration/       # Flask blueprints for dummy server integration
│       ├── routes.py
│       ├── scheduler.py
│       ├── dummy_client.py
│       ├── staging_db.py
│       ├── business_key.py
│       └── config.py
│
├── dummy_server/                # Independent FastAPI app (external system simulator)
│   ├── app.py                   # FastAPI entrypoint (port 9000)
│   ├── config.py
│   ├── database.py
│   ├── models.py                # target_data ORM model (JSONB row_data)
│   ├── schemas.py               # Pydantic response models
│   ├── api/target.py            # GET /target-data endpoint
│   ├── services/target_service.py
│   ├── seed_sample_data.py      # Seeds sample rows for testing
│   ├── seed_targets.py
│   ├── seed_cjbs_target.py
│   ├── seed_utils.py
│   ├── target_registry.py
│   ├── data/                    # Sample Excel files for seeding
│   ├── requirements.txt
│   └── Dockerfile
│
└── frontend/
    ├── index.html
    ├── vite.config.js           # Dev server + /api proxy config
    ├── package.json
    ├── Dockerfile
    └── src/
        ├── App.jsx              # Main app shell, routing, EDA modal, AR results panel
        ├── ARReconcileView.jsx  # AR Reconciliation UI (upload → mapping → results)
        ├── AuthContext.jsx      # JWT auth state + login/register hooks
        ├── LandingPage.jsx      # Public landing page + inline auth form
        ├── ChatWidget.jsx       # AI Assistant widget (provider + model picker)
        └── styles.css
```

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- A free [Groq API key](https://console.groq.com) (optional — app works with Ollama fallback)

### 1. Clone and configure

```bash
git clone <repo-url>
cd Reconciliation
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
GROQ_API_KEY=gsk_...          # From https://console.groq.com → API Keys
JWT_SECRET=<long-random-string>
```

### 2. Start all services

```bash
docker compose up --build
```

This starts four containers: `db`, `backend`, `frontend`, `dummy_server`, and `target_db`.

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:5000 |
| Dummy Server | http://localhost:9000 / http://localhost:9000/docs |
| PostgreSQL (main) | localhost:5432 |
| PostgreSQL (target) | localhost:5433 |

### 3. Seed dummy target data (first run only)

```bash
docker compose exec dummy_server python -m dummy_server.seed_sample_data
```

### 4. Run without Docker (development)

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env   # adjust DATABASE_URL
alembic upgrade head
python app.py

# Frontend (separate terminal)
cd frontend
npm install
npm run dev

# Dummy Server (separate terminal, run from backend/ dir)
cd backend
uvicorn dummy_server.app:app --host 0.0.0.0 --port 9000 --reload
```

---

## Environment Variables

### Root `.env` (passed to Docker Compose)

| Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | *(required)* | Groq API key. Leave empty to use Ollama only. |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Groq endpoint |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Default Groq model |
| `GROQ_TIMEOUT` | `120` | Request timeout in seconds |
| `GROQ_MAX_RETRIES` | `3` | Retries on 429/5xx |
| `GROQ_BACKOFF_SECONDS` | `2` | Exponential backoff base |
| `GROQ_MAX_INPUT_CHARS` | `0` | `0` = use per-model defaults |
| `OLLAMA_BASE_URL` | `http://100.93.93.84:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3.2:3b` | Ollama model name |
| `JWT_SECRET` | *(replace in prod)* | JWT signing secret |
| `JWT_ACCESS_TOKEN_EXPIRES_HOURS` | `24` | Token lifetime |
| `DATABASE_URL` | `postgresql://consistency:consistency@db:5432/consistency` | Main DB |
| `DUMMY_SERVER_BASE_URL` | `http://dummy_server:9000` | Dummy server URL (inside Docker) |

### `backend/.env.example` — backend-specific overrides

Same variables as above, intended for non-Docker local development.

### `frontend/.env.example`

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | *(empty)* | Leave empty for dev (Vite proxy handles `/api`). Set to absolute URL in production. |

---

## Services

### Backend (Flask)

Entry point: `backend/app.py`  
Port: `5000`

The Flask app exposes all `/api/*` routes. On startup, `entrypoint.sh` runs `alembic upgrade head` (with a fallback to `alembic stamp head` if tables already exist) before starting the server. CORS is configured to allow requests from localhost and configured ngrok tunnel URLs.

Key modules:

| Module | Role |
|---|---|
| `app.py` | All REST endpoints, request routing, response shaping |
| `auth.py` | JWT issue/verify, `/api/auth/*` blueprint |
| `admin_routes.py` | `/api/admin/*` blueprint (admin-only operations) |
| `database.py` | Lazy SQLAlchemy engine — only connects when first DB op runs |
| `db.py` | Series CRUD, row snapshot persistence, value history pivot |
| `storage.py` | File chunk storage, report read/write, `vector_store/` I/O |
| `fuzzy_match.py` | TF-IDF vectorisation + cosine similarity for rename detection |
| `insights.py` | KMeans clustering of cell-level changes → plain English summaries |
| `schema_engine.py` | Schema mapping analysis between two file versions |
| `row_reconcile_engine.py` | Row-level reconciliation by index or business key |
| `groq_service.py` | Groq chat client with per-model input trimming and retry logic |
| `ollama_service.py` | Ollama chat client (local fallback) |
| `ar_column_mapper.py` | Schema-agnostic column mapper (see [Dynamic Column Mapper](#dynamic-column-mapper)) |
| `ar_reconcile.py` | AR reconciliation engine (see [AR Reconciliation Engine](#ar-reconciliation-engine)) |

### Frontend (React + Vite)

Entry point: `frontend/src/App.jsx`  
Dev port: `5173`

The Vite dev server proxies all `/api/*` requests to `http://localhost:5000`, so no absolute URLs are needed in development. In production, set `VITE_API_BASE_URL` to your backend's public address.

Key components:

| Component | Role |
|---|---|
| `App.jsx` | App shell, view routing, EDA modal, AR results panel |
| `ARReconcileView.jsx` | 3-step AR reconciliation UI (upload → mapping review → results) |
| `ChatWidget.jsx` | Floating AI assistant with provider/model picker |
| `AuthContext.jsx` | JWT login/register/logout context provider |
| `LandingPage.jsx` | Public landing page with inline auth form |

### Dummy Server (FastAPI)

Entry point: `backend/dummy_server/app.py`  
Port: `9000`  
Docs: `http://localhost:9000/docs`

A completely independent FastAPI app that simulates an external enterprise system (ERP / SAP / Oracle). It reads "target" rows from its own Postgres database (`target_db`) and returns them as JSON. The main backend calls it via `DUMMY_SERVER_BASE_URL`.

To swap in a real external system: replace `services/target_service.py` and `database.py` with a real API/DB client. The route and response shape stay the same.

**Endpoint:**

```
GET /target-data[?project_name=...&entity_name=...]
GET /health
```

---

## Core Features

### Dynamic Column Mapper

**Files:** `backend/ar_column_mapper.py`, `backend/ar_synonyms.json`

Resolves arbitrary file headers onto a fixed set of canonical fields without any code changes when a new naming convention appears.

**Canonical transactional fields:**  
`TxnNumber, TxnType, TxnDate, Amount, Customer, PONumber, DueDate, Salesperson, Currency, Status`

**Three-tier resolution (in priority order):**

| Tier | Method | Description |
|---|---|---|
| 1 | Exact synonym match | Normalised header exactly equals a known synonym |
| 2 | Fuzzy match | `difflib.SequenceMatcher` against all synonyms; default cutoff `0.72`; substring credit for compound headers |
| 3 | Manual override | User/admin-supplied `{canonical_field: actual_column}` mapping; wins over tiers 1–2 |

Additional behaviours:
- **Header-row auto-detection:** scans first 10 rows, scores each by synonym matches, picks the best row — handles title/banner rows and double stacked headers.
- **Value normalisation after mapping:** amounts strip currency symbols/commas and handle `(1,234.56)` → `-1234.56`; dates use a tolerant multi-format parser; unparseable values become `null` and route to the exceptions report.
- **Synonym dictionary** (`ar_synonyms.json`) is externally configurable — add new source systems by editing JSON only.
- Every resolution decision is logged: field, matched column, method, confidence score.

### Auto File-Type Detection

**File:** `backend/ar_column_mapper.py` → `detect_file_type()`  
**Endpoint:** `POST /api/ar/detect-type`

On file upload, the system scores the file against multiple signals and classifies it as **Transactional** or **Master Data**:

| Signal | Transactional indicator |
|---|---|
| Header vocabulary | Headers match transactional synonym dictionary better |
| Date column behaviour | Parses as date, wide continuous range across rows |
| Amount column variation | Per-row monetary values (not a constant reference) |
| Key cardinality | Business entity (e.g. Customer) repeats; transaction key is near-unique |
| Due date presence | Aging, due dates, or payment terms present |

Returns `{ type, confidence, signals }`. If confidence is below `0.6`, the UI asks the user to confirm rather than routing silently.

### AR Reconciliation Engine

**Files:** `backend/ar_reconcile.py`, `backend/ar_column_mapper.py`  
**Endpoint:** `POST /api/ar/reconcile`

Accepts two files (source + target) with optional parameters:

| Parameter | Default | Description |
|---|---|---|
| `tolerance` | `0.01` | Amount match tolerance in dollars |
| `fuzzy_cutoff` | `0.72` | Fuzzy column-match confidence cutoff |
| `manual_src_map` | `{}` | Manual canonical→column overrides for source |
| `manual_tgt_map` | `{}` | Manual canonical→column overrides for target |

**Matching process:**

1. Load and map both files via `load_and_map()` (header detection → column mapping → value normalisation).
2. Split out exceptions (null keys, null amounts, footer/subtotal rows).
3. **Tier-1 match:** exact `(TxnNumber, TxnType)` key outer merge.
4. **Tier-2 match:** strip trailing `-N` suffix (e.g. `INV-001-2` → `INV-001`) and re-check amount equality — surfaces as a distinct category.
5. Produce result sets: `matched`, `disputed` (amount mismatch), `unmatched_source`, `unmatched_target`, `tier2_rows`, `duplicate_source_rows`, `duplicate_target_rows`, `source_exceptions`, `target_exceptions`.

**Response includes:**
- `summary` — counts, totals (`source_invoice_total`, `target_invoice_total`, `invoice_difference`), tolerance
- All result sets as JSON arrays
- `src_report` / `tgt_report` — full column mapping logs for audit

### Master Data Reconciliation

**Endpoint:** `POST /api/reconcile` (standard series flow)

For Master Data files the app runs `difference_summary()` which produces:
- Row-level diffs: Matched, Updated, Inserted, Deleted, Renamed (fuzzy-matched keys), Duplicates
- Schema diff: columns only in source vs only in target
- Quality score
- Plain English narrative via `insights.py` (KMeans clustering of cell-level changes)

Results are stored per series version and viewable in the day-by-day scoreboard.

### AI Chat Assistant

**Files:** `backend/groq_service.py`, `backend/ollama_service.py`, `frontend/src/ChatWidget.jsx`  
**Endpoint:** `POST /api/chat`

The chat widget answers questions about reconciliation reports. It supports three provider modes:

| Mode | Behaviour |
|---|---|
| `auto` (default) | Try Groq first; automatically fall back to Ollama on failure |
| `groq` | Use Groq; fall back to Ollama if the selected model fails |
| `ollama` | Use local Ollama only |

**Available Groq models:**

| Model ID | Label |
|---|---|
| `llama-3.3-70b-versatile` | Best overall (Meta) |
| `llama-3.1-8b-instant` | Fastest (Meta) |
| `openai/gpt-oss-20b` | GPT-OSS 20B |
| `openai/gpt-oss-120b` | GPT-OSS 120B |
| `qwen/qwen3.6-27b` | Qwen 3.6 27B |
| `groq/compound-mini` | Compound Mini (Groq) |

**Prompt-size handling:** Each model has a configured `GROQ_MODEL_MAX_INPUT_CHARS` limit. If the reconciliation context exceeds that limit, `_trim_prompt()` preserves the head (system instructions + stats) and tail (chat history + user question) and drops only middle sample rows.

**Rate-limit fallback:** If a Groq model hits its daily token cap (100k TPD on free tier), the backend automatically falls back to Ollama and returns a `note` field. The chat widget renders this as a subtle amber bubble so the user knows which provider answered.

### Vector Database & Semantic Analysis

**Files:** `backend/storage.py`, `backend/fuzzy_match.py`, `backend/insights.py`

The app uses several vector/semantic techniques without an external vector DB service:

**1. File chunk storage (`storage.py`)**  
Uploaded files are extracted to text (`column: value; ...` pairs per row), chunked to ≤800 characters, and persisted as JSON in `vector_store/{file_id}.json`. Designed to be swapped with ChromaDB or similar when scaling up.

**2. Fuzzy key matching (`fuzzy_match.py`)**  
Unmatched keys after exact reconciliation are vectorised with `TfidfVectorizer` (character n-grams `(2,4)`). Cosine similarity above `DEFAULT_THRESHOLD = 0.6` links a deleted key and an added key as a rename rather than two separate events.

**3. Semantic clustering (`insights.py`)**  
Cell-level change descriptions (`"column: before → after"`) are vectorised with `TfidfVectorizer` (word n-grams `(1,2)`) and clustered with KMeans (`n_clusters = max(2, min(5, n_texts // 3))`). Each cluster becomes a plain English trend sentence in the day-wise report.

**4. Reports directory (`vector_store/reports/`)**  
Per-series diff JSON and Excel reports are stored here via `save_series_diff_json()` in `storage.py`.

**5. PostgreSQL row history**  
Every version upload calls `save_row_snapshot()` to write a JSONB snapshot to the `series_row_values` table. The `/api/series/<id>/history` endpoint pivots this into a value-over-time grid (e.g. Day 1: 1545, Day 2: 1550).

### EDA Modal

**File:** `frontend/src/App.jsx`

Opened from any day card in the scoreboard. Adapts its content based on what data is available:

| Condition | Content shown |
|---|---|
| Master data series | 7-cell KPI strip + Comparison Summary cards |
| Transactional series (no AR run) | 7-cell KPI strip + Invoice Financial Summary (Source Total, Target Total, Difference) + Comparison Summary |
| Transactional series + AR run done | 11-cell AR KPI strip + AR Financial Summary + Transaction Breakdown pie chart |

**Invoice total computation priority:**
1. `invoice_summary` embedded in the saved report (computed server-side by `transactional_difference_summary()`)
2. Client-side fallback: sums amount columns from `full_comparison.rows` — detects amount column independently for source and target sides, handles older saved reports without `invoice_summary`

---

## API Reference

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login, returns JWT |
| POST | `/api/auth/logout` | Invalidate session |
| GET | `/api/auth/me` | Current user info |

### Files & Series

| Method | Path | Description |
|---|---|---|
| POST | `/api/upload` | Upload a file |
| GET | `/api/files` | List uploaded files |
| DELETE | `/api/files/<id>` | Delete a file |
| POST | `/api/series` | Create a new series |
| GET | `/api/series` | List series |
| GET | `/api/series/<id>` | Get series detail |
| POST | `/api/series/<id>/version` | Add a new version to a series |
| DELETE | `/api/series/<id>` | Delete a series |
| GET | `/api/series/<id>/history` | Value-over-time pivot grid |

### Reconciliation

| Method | Path | Description |
|---|---|---|
| POST | `/api/reconcile` | Standard diff (master or transactional series flow) |
| POST | `/api/ar/detect-type` | Detect file type (Transactional / Master Data) |
| POST | `/api/ar/reconcile` | Full AR reconciliation (schema-agnostic, two files) |

### AI Chat

| Method | Path | Description |
|---|---|---|
| POST | `/api/chat` | Send a message to the AI assistant |

Body: `{ "message": "...", "context": "...", "provider": "auto|groq|ollama", "model": "<groq-model-id>" }`

### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/users` | Admin | List all users |
| POST | `/api/admin/users` | Admin | Create user |
| DELETE | `/api/admin/users/<id>` | Admin | Delete user |
| DELETE | `/api/admin/clear-data` | Admin | Wipe all series/files/reports |

### Dummy Server

| Method | Path | Description |
|---|---|---|
| GET | `/target-data` | Fetch target rows (`?project_name=&entity_name=`) |
| GET | `/health` | Health check |

---

## Database

Managed by **Alembic**. Migrations live in `backend/alembic/versions/`.

| Migration | Description |
|---|---|
| `0001` | Create users table |
| `0002` | Create series, datasets tables (idempotent — skips if tables exist) |
| `0003` | Add role column + sessions table |
| `0004` | Create schema mapping tables |

`entrypoint.sh` runs `alembic upgrade head` on every container start. If tables already exist from a pre-Alembic run, it falls back to `alembic stamp head` to avoid `DuplicateTable` errors.

The SQLAlchemy engine is **lazy** (`database.py`) — no connection is attempted at import time. The app starts successfully even when Postgres is temporarily unreachable.

---

## Authentication

JWT-based auth via `backend/auth.py` and `backend/repositories/`.

- Tokens are issued on login and expire after `JWT_ACCESS_TOKEN_EXPIRES_HOURS` (default 24h).
- Routes are protected with `@require_auth` (any authenticated user) or `@admin_required` (admin role only).
- An admin bootstrap user is created automatically on first startup if no admin exists.
- The frontend stores the JWT in memory via `AuthContext.jsx` and attaches it as a `Bearer` header on every API call.

---
