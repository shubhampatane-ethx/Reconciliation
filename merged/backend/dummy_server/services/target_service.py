"""
=====================================================================
 DUMMY SERVER  ->  services/target_service.py
=====================================================================
Reads target data from Postgres in the Target_Data database.

CHANGED — Multi-target addition:
    This used to hard-code TARGET_TABLE = "cjbs_target_table", so
    every request returned CJBS rows no matter what project_name was
    passed in -- that's why only CJBS values ever showed up, even for
    Etairos / Airetech / ATS source files.

    Now the table is resolved per-request from project_name via
    target_registry.py (the same registry seed_targets.py uses to
    load each workbook), so each project's own table is queried.
    entity_name is still accepted for API compatibility but isn't
    used for table selection (each project currently maps 1:1 to a
    single table).

Each row is returned as a plain dict so the API layer can wrap it in
the standard {"total_records": N, "data": [...]} response shape.
The dict is placed under a "row_data" key to stay compatible with
the shape that auto_reconcile() in routes.py already expects:

    {"row_data": {"col1": val1, "col2": val2, ...}}

No ORM model is used here because the target tables have real columns
(not JSONB), so we just SELECT * and let the driver give us dicts.
=====================================================================
"""

import logging
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import text

from dummy_server.target_registry import resolve_entry

logger = logging.getLogger("dummy_server.target_service")


def get_target_data(
    db: Session,
    project_name: Optional[str] = None,
    entity_name: Optional[str] = None,
):
    """
    Fetch every row from the target table matching project_name
    (via target_registry.py) as a list of dicts. Falls back to the
    CJBS table if project_name is missing/unrecognized, matching the
    old default behaviour.

    Returns:
        List of dicts, each with shape:
            {"id": <row_number>, "row_data": {<all column: value pairs>}}
        This matches the TargetRow schema expected by the API layer.
    """
    resolved_project, entry = resolve_entry(project_name)
    target_table = entry["table"]

    try:
        # Fetch column names first so we can build proper dicts.
        result = db.execute(text(f'SELECT * FROM "{target_table}"'))
        columns = list(result.keys())
        raw_rows = result.fetchall()
    except Exception as exc:
        logger.error(
            "Failed to query %s (resolved from project_name=%r): %s",
            target_table, project_name, exc,
        )
        raise

    rows = []
    for idx, raw_row in enumerate(raw_rows, start=1):
        row_dict = dict(zip(columns, raw_row))

        # Convert any non-JSON-serialisable types (Decimal, date, datetime,
        # UUID, etc.) to strings so FastAPI's response serialiser never chokes.
        safe_dict = {}
        for k, v in row_dict.items():
            if v is None:
                safe_dict[k] = None
            elif isinstance(v, (int, float, bool)):
                safe_dict[k] = v
            elif isinstance(v, str):
                safe_dict[k] = v
            else:
                # datetime, date, Decimal, UUID, or anything else -> string
                safe_dict[k] = str(v)

        rows.append({
            "id": idx,
            "project_name": resolved_project,
            "entity_name": entity_name or target_table,
            "business_key": None,
            "updated_at": None,
            "row_data": safe_dict,
        })

    logger.info(
        "%s returned %d row(s) (requested project_name=%s -> resolved=%s, entity=%s)",
        target_table, len(rows), project_name, resolved_project, entity_name,
    )
    return rows
