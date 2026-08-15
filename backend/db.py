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

Schema management:
    As of migration 0002, ALL FOUR tables this module talks to
    (series, datasets, series_versions, series_row_values) — not just
    `users` — are created and evolved exclusively through Alembic
    (see backend/alembic/versions/, and the ORM model definitions in
    models.py). This module used to create/alter those tables itself
    at runtime via a hand-written CREATE TABLE IF NOT EXISTS string;
    that has been removed. init_schema() below now only *verifies*
    the tables exist — it does not create them. Run
    `alembic upgrade head` (see backend/alembic.ini) before starting
    the app. CRUD in this module still goes through raw psycopg2
    rather than the ORM, unchanged — only table *creation* moved to
    Alembic, not the query layer.
"""

import json
import os
from collections import defaultdict
from contextlib import contextmanager
from typing import Dict, List, Optional

from normalize import canonical_value, display_value

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
# Schema — owned entirely by Alembic now (see backend/alembic/versions/
# 0001_create_users_table.py and 0002_create_series_datasets_tables.py,
# and the ORM models in models.py). This module no longer contains any
# CREATE TABLE / ALTER TABLE DDL — it only verifies, at startup, that
# the tables it's about to query already exist, so a misconfigured
# deployment (forgot to run `alembic upgrade head`) fails with a clear
# log message instead of a confusing "relation does not exist" error
# on the first request.
# ---------------------------------------------------------------------------
REQUIRED_TABLES = (
    "series",
    "datasets",
    "series_versions",
    "series_row_values",
    "reconciliation_mapping_sessions",
    "header_column_mappings",
    "row_index_mappings",
)


def init_schema():
    """Verify the tables this module needs already exist (created via
    `alembic upgrade head`). Safe to call on every app startup.

    This intentionally does NOT create or alter any tables anymore —
    that responsibility moved to Alembic. If Postgres isn't reachable
    this is a no-op (same graceful-degradation behaviour as before).
    If Postgres IS reachable but migrations haven't been run, this
    logs a warning listing the missing tables so the problem is
    obvious instead of surfacing later as a scattered stack trace.
    """
    global _schema_initialized
    if not is_available():
        return False
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = ANY(%s)",
                (list(REQUIRED_TABLES),),
            )
            existing = {row[0] for row in cur.fetchall()}
    missing = [t for t in REQUIRED_TABLES if t not in existing]
    if missing:
        print(
            "[db] WARNING: missing table(s) "
            f"{missing} — run `alembic upgrade head` in backend/ before "
            "using features that depend on them. The app will keep "
            "running, but Postgres-backed series/dataset features will "
            "silently no-op until migrations are applied."
        )
        _schema_initialized = False
        return False
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
    # If the uploaded file has duplicate key values, a single INSERT ...
    # ON CONFLICT DO UPDATE batch can't touch the same (series_id, version,
    # row_key) target row twice — Postgres raises "ON CONFLICT DO UPDATE
    # command cannot affect row a second time". Those duplicate rows are
    # already surfaced separately in the diff report's "Duplicates" bucket,
    # so here we just keep the first occurrence of each key for the
    # snapshot rather than letting the whole upload fail.
    seen_keys = set()
    payload = []
    for row in records:
        key = _row_key(row, key_columns)
        if not key.strip() or key in seen_keys:
            continue
        seen_keys.add(key)
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
            # "Changed" is decided on the CANONICAL value (same rule the main
            # Source-vs-Target dashboard uses) so a cosmetic formatting
            # difference — e.g. "2026-11-01" vs "2026-11-01 00:00:00", which
            # are the same date — is not counted as a real change here either.
            distinct_canonical = {canonical_value(v) for v in values.values() if v is not None}
            changed = len(distinct_canonical) > 1
            if only_changed and not changed:
                continue
            # Show a cleaned-up value for display (dates without a redundant
            # "00:00:00" time, etc.) instead of raw text — so Source and
            # Target display identically when they're really the same value.
            display_values = {v_key: (None if v is None else display_value(v)) for v_key, v in values.items()}
            entries.append({
                "row_key": row_key,
                "column": col,
                "values": display_values,
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


def save_mapping_session(
    session_id: str,
    user_id: Optional[int],
    source_dataset_id: Optional[str],
    target_dataset_id: Optional[str],
    mapping_mode: str,
    header_mappings: Optional[List[Dict]] = None,
    row_mappings: Optional[List[Dict]] = None,
) -> Dict:
    """Persists or updates a reconciliation mapping session and its detailed mapping items."""
    if not is_available():
        return {"session_id": session_id, "mapping_mode": mapping_mode, "persisted": False}

    with _get_conn() as conn:
        with conn.cursor() as cur:
            # Upsert mapping session
            cur.execute(
                """
                INSERT INTO reconciliation_mapping_sessions
                    (id, user_id, source_dataset_id, target_dataset_id, mapping_mode, updated_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (id) DO UPDATE
                    SET mapping_mode = EXCLUDED.mapping_mode,
                        source_dataset_id = COALESCE(EXCLUDED.source_dataset_id, reconciliation_mapping_sessions.source_dataset_id),
                        target_dataset_id = COALESCE(EXCLUDED.target_dataset_id, reconciliation_mapping_sessions.target_dataset_id),
                        version = reconciliation_mapping_sessions.version + 1,
                        updated_at = NOW()
                """,
                (session_id, user_id, source_dataset_id, target_dataset_id, mapping_mode),
            )

            # Persist Header Mappings if mode is HEADER_COLUMN
            if mapping_mode == "HEADER_COLUMN" and header_mappings:
                cur.execute("DELETE FROM header_column_mappings WHERE session_id = %s", (session_id,))
                for hm in header_mappings:
                    cur.execute(
                        """
                        INSERT INTO header_column_mappings
                            (session_id, source_column, target_column, confidence_score, is_key, match_explanation)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (
                            session_id,
                            hm["source_column"],
                            hm["target_column"],
                            hm.get("confidence_score", 1.0),
                            hm.get("is_key", False),
                            json.dumps(hm.get("match_explanation")) if hm.get("match_explanation") else None,
                        ),
                    )

            # Persist Row Mappings if mode is ROW_INDEX
            if mapping_mode == "ROW_INDEX" and row_mappings:
                cur.execute("DELETE FROM row_index_mappings WHERE session_id = %s", (session_id,))
                for rm in row_mappings:
                    cur.execute(
                        """
                        INSERT INTO row_index_mappings
                            (session_id, source_index, target_index, source_internal_id, target_internal_id)
                        VALUES (%s, %s, %s, %s, %s)
                        """,
                        (
                            session_id,
                            rm["source_index"],
                            rm["target_index"],
                            rm.get("source_internal_id", f"SRC_{rm['source_index']}"),
                            rm.get("target_internal_id", f"TGT_{rm['target_index']}"),
                        ),
                    )

    return {"session_id": session_id, "mapping_mode": mapping_mode, "persisted": True}


def get_mapping_session(session_id: str) -> Optional[Dict]:
    """Retrieves a saved mapping session with its header or row mappings."""
    if not is_available():
        return None

    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute("SELECT * FROM reconciliation_mapping_sessions WHERE id = %s", (session_id,))
            sess = cur.fetchone()
            if not sess:
                return None

            sess_dict = dict(sess)
            mode = sess_dict["mapping_mode"]

            if mode == "HEADER_COLUMN":
                cur.execute("SELECT * FROM header_column_mappings WHERE session_id = %s ORDER BY id", (session_id,))
                h_rows = [dict(r) for r in cur.fetchall()]
                sess_dict["header_mappings"] = h_rows
            elif mode == "ROW_INDEX":
                cur.execute("SELECT * FROM row_index_mappings WHERE session_id = %s ORDER BY id", (session_id,))
                r_rows = [dict(r) for r in cur.fetchall()]
                sess_dict["row_mappings"] = r_rows

            return sess_dict

