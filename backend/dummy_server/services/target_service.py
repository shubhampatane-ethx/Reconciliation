"""
=====================================================================
 DUMMY SERVER  ->  services/target_service.py
=====================================================================
Reads target data from the user's own `cjbs_target_table` table in
the Target_Data PostgreSQL database using raw SQL.

Each row is returned as a plain dict so the API layer can wrap it in
the standard {"total_records": N, "data": [...]} response shape.
The dict is placed under a "row_data" key to stay compatible with
the shape that auto_reconcile() in routes.py already expects:

    {"row_data": {"col1": val1, "col2": val2, ...}}

No ORM model is used here because cjbs_target_table has real columns
(not JSONB), so we just SELECT * and let the driver give us dicts.
=====================================================================
"""

import logging
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import text

logger = logging.getLogger("dummy_server.target_service")

# The real target table in the user's Target_Data database.
TARGET_TABLE = "cjbs_target_table"


def get_target_data(
    db: Session,
    project_name: Optional[str] = None,
    entity_name: Optional[str] = None,
):
    """
    Fetch every row from cjbs_target_table as a list of dicts.

    project_name / entity_name filters are accepted for API
    compatibility but ignored if cjbs_target_table has no such
    columns — the function simply returns all rows in that case.
    This means you don't need to add those columns to your table;
    they're optional conveniences for multi-tenant setups.

    Returns:
        List of dicts, each with shape:
            {"id": <row_number>, "row_data": {<all column: value pairs>}}
        This matches the TargetRow schema expected by the API layer.
    """
    try:
        # Fetch column names first so we can build proper dicts.
        result = db.execute(text(f"SELECT * FROM \"{TARGET_TABLE}\""))
        columns = list(result.keys())
        raw_rows = result.fetchall()
    except Exception as exc:
        logger.error("Failed to query %s: %s", TARGET_TABLE, exc)
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
                # datetime, date, Decimal, UUID, or anything else → string
                safe_dict[k] = str(v)

        rows.append({
            "id": idx,
            "project_name": project_name or "default_project",
            "entity_name": entity_name or "cjbs_target_table",
            "business_key": None,
            "updated_at": None,
            "row_data": safe_dict,
        })

    logger.info(
        "cjbs_target_table returned %d row(s) (project=%s, entity=%s)",
        len(rows), project_name, entity_name,
    )
    return rows
