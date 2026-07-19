"""
Postgres-backed metadata store for the "Reconcile Over Time" (series)
feature, extended with user authentication and dataset ownership.

This runs ALONGSIDE the existing file-based storage in storage.py, not
instead of it — storage.py's JSON/CSV files remain the source of truth
for the app to keep working, so nothing else in app.py breaks if Postgres
isn't configured. This module is purely additive: it mirrors series and
version metadata into Postgres, and — the actual point of it — stores a
per-row, per-day snapshot of the data so that the value of any column,
for any key row, can be pulled back out as a "days going across" history:

    Project Alpha | Cost Per Trip/Day | 100 (Source) | 120 (Day 1) | 120 (Day 2) | 140 (Day 3)

There is a user_id foreign-key on the series/datasets tables so every
dataset is owned by exactly one user. The `users` table itself, and all
user CRUD (create/read/update/delete), live outside this module now:
the table is defined by the SQLAlchemy `User` model (models.py) and
created/migrated via Alembic (backend/alembic/), and CRUD goes through
repositories/user_repository.py. This module only ever references
users.id as a foreign-key value.

Every call in here is defensive: if DATABASE_URL isn't set or Postgres
isn't reachable, is_available() returns False and every write function
becomes a no-op, so local/offline usage of the app is unaffected.
"""

import json
import os
from collections import defaultdict
from contextlib import contextmanager
from typing import Dict, List, Optional

try:
    import psycopg2
    import psycopg2.extras
    _PSYCOPG2_AVAILABLE = True
except ImportError:  # psycopg2 isn't installed in every environment (e.g. tests)
    _PSYCOPG2_AVAILABLE = False

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://consistency:consistency@localhost:5432/consistency",
)

_schema_initialized = False


def is_available() -> bool:
    """Cheap reachability check. Called before every DB operation so the
    rest of the app can keep working with file-based storage alone if
    Postgres isn't configured or isn't up (e.g. local dev without Docker)."""
    if not _PSYCOPG2_AVAILABLE:
        return False
    try:
        conn = psycopg2.connect(DATABASE_URL, connect_timeout=2)
        conn.close()
        return True
    except Exception:
        return False


@contextmanager
def _get_conn():
    conn = psycopg2.connect(DATABASE_URL, connect_timeout=5)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Schema — additive migrations via ALTER TABLE … IF NOT EXISTS so the
# app can upgrade a running database without manual intervention.
# ---------------------------------------------------------------------------
SCHEMA = """
-- NOTE: the `users` table is intentionally NOT created here. It is
-- owned by the SQLAlchemy `User` model (models.py) and created /
-- migrated exclusively via Alembic — see backend/alembic/. Run
-- `alembic upgrade head` before starting the app (or before calling
-- init_schema() below) so the tables that reference users(id) via
-- foreign key can be created successfully.

-- ── Series (datasets) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS series (
    series_id   TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    key_columns JSONB,
    user_id     INT REFERENCES users(id) ON DELETE SET NULL
);

-- Back-fill: add user_id column to an older series table that predates auth.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'series' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE series ADD COLUMN user_id INT REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ── Dataset metadata (mirrors series for the chatbot feature) ─────────────
-- Kept as a view-like denormalised companion to the series table so the
-- chat API can quickly answer questions like "what columns does this
-- dataset have?" without loading the full diff report from disk.
CREATE TABLE IF NOT EXISTS datasets (
    dataset_id         TEXT PRIMARY KEY,   -- == series_id
    dataset_name       TEXT NOT NULL,
    original_file_name TEXT,
    user_id            INT REFERENCES users(id) ON DELETE CASCADE,
    upload_timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
    record_count       INT DEFAULT 0,
    file_type          TEXT,
    column_names       JSONB,
    embedding_status   TEXT NOT NULL DEFAULT 'pending',
    reconciliation_history JSONB DEFAULT '[]'::jsonb
);

-- ── Series versions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS series_versions (
    id            SERIAL PRIMARY KEY,
    series_id     TEXT NOT NULL REFERENCES series(series_id) ON DELETE CASCADE,
    version       INT NOT NULL,
    label         TEXT,
    filename      TEXT,
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_count     INT,
    column_count  INT,
    key_columns   JSONB,
    diff_summary  JSONB,
    report_file   TEXT,
    UNIQUE (series_id, version)
);

-- ── Row-level value snapshots (day-over-day history) ─────────────────────
-- One row per (series, version, key). row_data is the full row as it
-- looked on that day. This is the table the "days as columns" history
-- view is built from: fetch every version's row_data for a given
-- row_key and pivot it in Python.
CREATE TABLE IF NOT EXISTS series_row_values (
    id         BIGSERIAL PRIMARY KEY,
    series_id  TEXT NOT NULL REFERENCES series(series_id) ON DELETE CASCADE,
    version    INT NOT NULL,
    row_key    TEXT NOT NULL,
    row_data   JSONB NOT NULL,
    UNIQUE (series_id, version, row_key)
);

CREATE INDEX IF NOT EXISTS idx_series_row_values_lookup
    ON series_row_values (series_id, row_key);

CREATE INDEX IF NOT EXISTS idx_series_user
    ON series (user_id);

CREATE INDEX IF NOT EXISTS idx_datasets_user
    ON datasets (user_id);
"""


def init_schema():
    """Create / migrate tables. Safe to call on every app startup —
    CREATE TABLE IF NOT EXISTS and the DO $$ migration blocks are idempotent."""
    global _schema_initialized
    if not is_available():
        return False
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
    _schema_initialized = True
    return True


# ---------------------------------------------------------------------------
# User / auth helpers
# ---------------------------------------------------------------------------
#
# NOTE: user CRUD (create/read/update/delete) has moved to
# repositories/user_repository.py, backed by the SQLAlchemy `User`
# model in models.py. Nothing in this module manages the `users` table
# anymore — see the NOTE at the top of SCHEMA above. Other functions in
# this file that need a user_id (e.g. get_series_owner, list_series_for_user
# below) still work unchanged, since they only reference users.id as a
# foreign key value, not the users table's own columns.


# ---------------------------------------------------------------------------
# Dataset helpers (denormalised companion to series)
# ---------------------------------------------------------------------------

def upsert_dataset(
    dataset_id: str,
    dataset_name: str,
    original_file_name: str,
    user_id: Optional[int],
    record_count: int = 0,
    file_type: str = "",
    column_names: Optional[List[str]] = None,
):
    """Create or update the datasets row for a series. Called whenever a
    new series (dataset) is created or its baseline version changes."""
    if not is_available():
        return
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO datasets
                    (dataset_id, dataset_name, original_file_name, user_id,
                     record_count, file_type, column_names, embedding_status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending')
                ON CONFLICT (dataset_id) DO UPDATE
                    SET dataset_name       = EXCLUDED.dataset_name,
                        original_file_name = EXCLUDED.original_file_name,
                        user_id            = COALESCE(EXCLUDED.user_id, datasets.user_id),
                        record_count       = EXCLUDED.record_count,
                        file_type          = EXCLUDED.file_type,
                        column_names       = COALESCE(EXCLUDED.column_names, datasets.column_names)
                """,
                (
                    dataset_id,
                    dataset_name,
                    original_file_name,
                    user_id,
                    record_count,
                    file_type,
                    json.dumps(column_names) if column_names else None,
                ),
            )


def append_reconciliation_history(dataset_id: str, history_entry: Dict):
    """Append a reconciliation event (version number, label, timestamp,
    diff_summary counts) to the dataset's reconciliation_history JSON array."""
    if not is_available():
        return
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE datasets
                SET reconciliation_history =
                    reconciliation_history || %s::jsonb
                WHERE dataset_id = %s
                """,
                (json.dumps([history_entry]), dataset_id),
            )


def get_dataset(dataset_id: str) -> Optional[Dict]:
    if not is_available():
        return None
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM datasets WHERE dataset_id = %s", (dataset_id,))
            row = cur.fetchone()
            return dict(row) if row else None


def list_datasets_for_user(user_id: int) -> List[Dict]:
    """Return all datasets owned by `user_id`, newest first."""
    if not is_available():
        return []
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM datasets WHERE user_id = %s ORDER BY upload_timestamp DESC",
                (user_id,),
            )
            return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Series metadata helpers (extended with user_id)
# ---------------------------------------------------------------------------

def upsert_series_metadata(
    series_id: str,
    name: str,
    key_columns: Optional[List[str]] = None,
    user_id: Optional[int] = None,
):
    if not is_available():
        return
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO series (series_id, name, key_columns, user_id)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (series_id) DO UPDATE
                    SET name        = EXCLUDED.name,
                        key_columns = COALESCE(EXCLUDED.key_columns, series.key_columns),
                        user_id     = COALESCE(EXCLUDED.user_id, series.user_id)
                """,
                (
                    series_id,
                    name,
                    json.dumps(key_columns) if key_columns else None,
                    user_id,
                ),
            )


def get_series_owner(series_id: str) -> Optional[int]:
    """Return the user_id that owns this series, or None if unowned/not found."""
    if not is_available():
        return None
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM series WHERE series_id = %s", (series_id,))
            row = cur.fetchone()
            return row[0] if row else None


def list_series_for_user(user_id: int) -> List[str]:
    """Return series_ids owned by this user."""
    if not is_available():
        return []
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT series_id FROM series WHERE user_id = %s ORDER BY created_at DESC",
                (user_id,),
            )
            return [row[0] for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Series version helpers (unchanged)
# ---------------------------------------------------------------------------

def upsert_series_version(
    series_id: str,
    version: int,
    label: str,
    filename: str,
    row_count: int,
    column_count: int,
    key_columns: Optional[List[str]],
    diff_summary: Optional[Dict],
    report_file: Optional[str],
):
    if not is_available():
        return
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO series_versions
                    (series_id, version, label, filename, row_count, column_count,
                     key_columns, diff_summary, report_file)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (series_id, version) DO UPDATE
                    SET label        = EXCLUDED.label,
                        filename     = EXCLUDED.filename,
                        row_count    = EXCLUDED.row_count,
                        column_count = EXCLUDED.column_count,
                        key_columns  = EXCLUDED.key_columns,
                        diff_summary = EXCLUDED.diff_summary,
                        report_file  = EXCLUDED.report_file
                """,
                (
                    series_id, version, label, filename, row_count, column_count,
                    json.dumps(key_columns) if key_columns else None,
                    json.dumps(diff_summary) if diff_summary is not None else None,
                    report_file,
                ),
            )


def save_row_snapshot(series_id: str, version: int, key_columns: List[str], df):
    """Store one row_data JSONB blob per row of `df`, keyed by its
    key-column value(s), for this (series, version). This is what makes
    the day-over-day column history possible later — every day's full
    row content is preserved, not just the diff.
    """
    if not is_available() or df is None or df.empty:
        return
    records = df.to_dict(orient="records")
    payload = []
    for row in records:
        key = _row_key(row, key_columns)
        if not key.strip():
            continue
        payload.append((series_id, version, key, json.dumps(row, default=str)))

    if not payload:
        return

    with _get_conn() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO series_row_values (series_id, version, row_key, row_data)
                VALUES %s
                ON CONFLICT (series_id, version, row_key) DO UPDATE
                    SET row_data = EXCLUDED.row_data
                """,
                payload,
            )


def _row_key(row: Dict, key_columns: List[str]) -> str:
    return " | ".join(str(row.get(col, "")).strip() for col in key_columns)


def get_value_history(
    series_id: str,
    columns_of_interest: Optional[List[str]] = None,
    only_changed: bool = True,
) -> Dict:
    """Build the 'days as columns' pivot: for every tracked row and every
    non-key column, the sequence of values across all stored versions.

    Returns:
        {
          "versions": [{"version": 0, "label": "Source"}, ...],
          "entries": [
              {"row_key": "Project Alpha", "column": "Cost Per Trip/Day",
               "values": {"0": "100", "1": "120", "2": "120", "3": "140"},
               "changed": true},
              ...
          ]
        }
    """
    empty = {"versions": [], "entries": []}
    if not is_available():
        return empty

    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT version, label FROM series_versions WHERE series_id = %s ORDER BY version",
                (series_id,),
            )
            versions = [{"version": r["version"], "label": r["label"]} for r in cur.fetchall()]
            # Version 0 (the untouched baseline) has no series_versions row of
            # its own (it's created directly against `series`), so make sure
            # it's represented if any row snapshots exist for it.
            cur.execute(
                "SELECT DISTINCT version FROM series_row_values WHERE series_id = %s AND version = 0",
                (series_id,),
            )
            if cur.fetchone() and not any(v["version"] == 0 for v in versions):
                versions.insert(0, {"version": 0, "label": "Source"})

            cur.execute(
                "SELECT version, row_key, row_data FROM series_row_values "
                "WHERE series_id = %s ORDER BY row_key, version",
                (series_id,),
            )
            rows = cur.fetchall()

    if not rows:
        return {"versions": versions, "entries": []}

    # Reshape: {row_key: {column: {version: value}}}
    by_row_column = defaultdict(lambda: defaultdict(dict))
    for r in rows:
        row_data = r["row_data"] or {}
        for col, val in row_data.items():
            if columns_of_interest and col not in columns_of_interest:
                continue
            by_row_column[r["row_key"]][col][str(r["version"])] = val

    entries = []
    for row_key, columns in by_row_column.items():
        for col, values in columns.items():
            distinct = {v for v in values.values() if v is not None}
            changed = len(distinct) > 1
            if only_changed and not changed:
                continue
            entries.append({
                "row_key": row_key,
                "column": col,
                "values": values,
                "changed": changed,
            })

    # Most-changed rows first, so the interesting history surfaces on top.
    entries.sort(key=lambda e: (-len(set(e["values"].values())), e["row_key"], e["column"]))
    return {"versions": versions, "entries": entries}


def delete_series_from_db(series_id: str):
    if not is_available():
        return
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM series WHERE series_id = %s", (series_id,))
            cur.execute("DELETE FROM datasets WHERE dataset_id = %s", (series_id,))
