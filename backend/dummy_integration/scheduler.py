"""
=====================================================================
 dummy_integration  ->  scheduler.py
=====================================================================
10-minute scheduled reconciliation job.

Every 10 minutes this job:
  1. Loads the most-recently-uploaded Source batch from source_staging
     (the same rows that were staged when the user last hit
     /api/dummy-integration/source-upload or /auto-reconcile).
  2. Calls the Dummy Server for fresh Target data.
  3. Runs the existing comparison engine (difference_summary /
     extract_day_summary / generate_plain_english_summary).
  4. Saves the result as a new Series version so it shows up in the
     existing "Reconcile Over Time" / "Reports" UI automatically.
  5. Stores a compact last-run summary (timestamp, counts, insights)
     in memory so the status endpoint can return it instantly.

The job runs completely OUTSIDE of any Flask request context — all
imports from app.py / storage.py / db.py happen at call time (not at
module load time) so there are no circular-import issues.
=====================================================================
"""

import logging
import threading
from datetime import datetime, timezone
from typing import Optional

import pandas as pd
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger("dummy_integration.scheduler")

# ---------------------------------------------------------------------------
# Module-level state (in-process, single server instance)
# ---------------------------------------------------------------------------

_scheduler: Optional[BackgroundScheduler] = None
_lock = threading.Lock()

# Compact summary of the last completed run, returned by the status endpoint.
_last_run: dict = {
    "status": "never_run",           # "never_run" | "running" | "success" | "error"
    "started_at": None,
    "finished_at": None,
    "series_id": None,
    "version": None,
    "project_name": None,
    "entity_name": None,
    "key_columns": None,
    "matched": 0,
    "added": 0,
    "deleted": 0,
    "updated": 0,
    "source_records": 0,
    "target_records": 0,
    "insights": None,
    "error": None,
}

INTERVAL_MINUTES = 10  # change here or via env SCHEDULER_INTERVAL_MINUTES


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_latest_source_from_staging() -> Optional[tuple]:
    """
    Pull the most recent upload batch from source_staging.

    Returns (df_source, project_name, entity_name, business_key) or None
    if the table is empty / unreachable.
    """
    try:
        from dummy_integration.staging_db import SessionLocal, SourceStaging
        from sqlalchemy import text

        session = SessionLocal()
        try:
            # Find the most recently uploaded batch_id
            row = (
                session.query(
                    SourceStaging.batch_id,
                    SourceStaging.project_name,
                    SourceStaging.entity_name,
                    SourceStaging.business_key,
                )
                .order_by(SourceStaging.uploaded_at.desc())
                .first()
            )
            if row is None:
                logger.warning("source_staging is empty — no source to reconcile against.")
                return None

            batch_id, project_name, entity_name, business_key = row

            # Load every row from that batch
            rows = (
                session.query(SourceStaging.row_data)
                .filter(SourceStaging.batch_id == batch_id)
                .all()
            )
            records = [r.row_data for r in rows]
            if not records:
                return None

            df = pd.DataFrame(records)
            return df, project_name, entity_name, business_key
        finally:
            session.close()

    except Exception as exc:
        logger.warning("Could not load latest source from staging DB: %s", exc)
        return None


def _run_reconciliation():
    """
    Core scheduled job — runs without any Flask request context.
    Mirrors the logic of auto_reconcile() in routes.py exactly, but
    operates on data already in the DB rather than a freshly uploaded file.
    """
    global _last_run

    started = datetime.now(timezone.utc).isoformat()
    with _lock:
        _last_run = {**_last_run, "status": "running", "started_at": started, "error": None}

    logger.info("[scheduler] Scheduled reconciliation started at %s", started)

    try:
        # -- Late imports to avoid circular dependencies at module load time --
        from app import (
            normalize_dataframe,
            guess_key_columns,
            difference_summary,
            extract_day_summary,
        )
        from insights import generate_plain_english_summary
        from storage import (
            create_series,
            add_series_version,
            save_series_diff_json,
            store_series_excel_report,
            list_series,
        )
        import db as db_module
        from dummy_integration.dummy_client import fetch_target_data

        # ── 1. Load latest source batch ──────────────────────────────────────
        source_result = _load_latest_source_from_staging()
        if source_result is None:
            msg = ("No source data found in staging table. "
                   "Upload a source file via /api/dummy-integration/source-upload first.")
            logger.warning("[scheduler] %s", msg)
            with _lock:
                _last_run = {
                    **_last_run,
                    "status": "error",
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "error": msg,
                }
            return

        df_source_raw, project_name, entity_name, business_key = source_result

        # Normalise exactly like the manual upload path does
        df_source = normalize_dataframe(df_source_raw)

        # Drop unnamed / fully-empty columns (same guard as auto_reconcile)
        unnamed = [c for c in df_source.columns if str(c).startswith("Unnamed:")]
        if unnamed:
            df_source = df_source.drop(columns=unnamed)
        df_source = df_source.dropna(axis=1, how="all")

        if df_source.empty:
            msg = "Source dataframe is empty after normalisation."
            logger.warning("[scheduler] %s", msg)
            with _lock:
                _last_run = {
                    **_last_run,
                    "status": "error",
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "error": msg,
                }
            return

        # ── 2. Fetch fresh target data from the Dummy Server ─────────────────
        target_response = fetch_target_data(
            project_name=project_name, entity_name=entity_name
        )
        target_rows = [
            item.get("row_data", {}) for item in target_response.get("data", [])
        ]

        if not target_rows:
            msg = (f"Dummy Server returned 0 target records for "
                   f"project={project_name} entity={entity_name}.")
            logger.warning("[scheduler] %s", msg)
            with _lock:
                _last_run = {
                    **_last_run,
                    "status": "error",
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "error": msg,
                }
            return

        df_target = normalize_dataframe(pd.DataFrame(target_rows))
        unnamed_t = [c for c in df_target.columns if str(c).startswith("Unnamed:")]
        if unnamed_t:
            df_target = df_target.drop(columns=unnamed_t)
        df_target = df_target.dropna(axis=1, how="all")

        # ── 3. Determine key columns ──────────────────────────────────────────
        if (business_key
                and business_key in df_source.columns
                and business_key in df_target.columns):
            key_columns = [business_key]
        else:
            key_columns = guess_key_columns(df_source, df_target)

        if not key_columns:
            msg = "Could not determine a matching key column between Source and Target."
            logger.error("[scheduler] %s", msg)
            with _lock:
                _last_run = {
                    **_last_run,
                    "status": "error",
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "error": msg,
                }
            return

        # ── 4. Run the comparison engine ──────────────────────────────────────
        source_label = "Source"
        target_label = f"Target (Scheduled {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC)"

        diff_report = difference_summary(df_source, df_target, key_columns)
        day_summary = extract_day_summary(df_source, df_target, key_columns, diff_report)
        insights = generate_plain_english_summary(
            diff_report, day_summary, key_columns, source_label, target_label
        )
        diff_report["day_summary"] = day_summary
        diff_report["insights"] = insights

        added   = diff_report["missing_in_source"]["count"]
        deleted = diff_report["missing_in_target"]["count"]
        updated = diff_report["mismatches"]["count"]
        total   = diff_report["full_comparison"]["count"]
        matched = max(total - deleted - added - updated, 0)

        diff_summary_meta = {
            "added": added,
            "deleted": deleted,
            "duplicates": (diff_report["duplicates_source"]["count"]
                           + diff_report["duplicates_target"]["count"]),
            "updated": updated,
            "renamed": diff_report["fuzzy_matches"]["count"],
            "format_issues": diff_report["format_inconsistencies"]["count"],
            "compared_against_version": 0,
            "compared_against_label": source_label,
        }

        # ── 5. Persist as a new Series version ───────────────────────────────
        # Use an existing open-ended series for this project/entity if one
        # exists (name = "scheduled:<project>/<entity>"), otherwise create one.
        series_name = f"scheduled:{project_name}/{entity_name}"
        existing = [s for s in list_series() if s.get("name") == series_name]

        if existing:
            from storage import get_series, add_series_version, load_version_dataframe
            series = get_series(existing[0]["series_id"])
            series_id = series["series_id"]

            # Add as next version on the existing series
            excel_info = store_series_excel_report(
                series_id, series["name"], source_label, target_label,
                len(series["versions"]) + 1,
                diff_report, key_columns, day_summary,
            )
            version_entry = add_series_version(
                series_id,
                f"dummy-server:{project_name}/{entity_name}",
                df_target, key_columns, diff_summary_meta,
                excel_info["report_file"], label=target_label,
            )
            next_version = version_entry["version"]
        else:
            # Brand-new series: version 0 = source, version 1 = first scheduled target
            series = create_series(series_name, f"{entity_name}_source", df_source)
            series_id = series["series_id"]
            db_module.upsert_series_metadata(series_id, series["name"])

            next_version = 1
            excel_info = store_series_excel_report(
                series_id, series["name"], source_label, target_label,
                next_version, diff_report, key_columns, day_summary,
            )
            version_entry = add_series_version(
                series_id,
                f"dummy-server:{project_name}/{entity_name}",
                df_target, key_columns, diff_summary_meta,
                excel_info["report_file"], label=target_label,
            )

        save_series_diff_json(series_id, next_version, diff_report)

        # Mirror to Postgres (no-op if DB is not reachable)
        db_module.upsert_series_metadata(series_id, series_name, key_columns)
        db_module.upsert_series_version(
            series_id, next_version, target_label,
            f"dummy-server:{project_name}/{entity_name}",
            int(len(df_target)), int(len(df_target.columns)),
            key_columns, diff_summary_meta, excel_info["report_file"],
        )
        db_module.save_row_snapshot(series_id, 0, key_columns, df_source)
        db_module.save_row_snapshot(series_id, next_version, key_columns, df_target)

        finished = datetime.now(timezone.utc).isoformat()
        logger.info(
            "[scheduler] Run finished. series=%s version=%s "
            "matched=%d added=%d deleted=%d updated=%d",
            series_id, next_version, matched, added, deleted, updated,
        )

        with _lock:
            _last_run = {
                "status": "success",
                "started_at": started,
                "finished_at": finished,
                "series_id": series_id,
                "version": next_version,
                "project_name": project_name,
                "entity_name": entity_name,
                "key_columns": key_columns,
                "matched": matched,
                "added": added,
                "deleted": deleted,
                "updated": updated,
                "source_records": int(len(df_source)),
                "target_records": int(len(df_target)),
                "insights": insights,
                "error": None,
            }

    except Exception as exc:
        logger.exception("[scheduler] Unhandled error in scheduled reconciliation")
        with _lock:
            _last_run = {
                **_last_run,
                "status": "error",
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "error": str(exc),
            }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_last_run() -> dict:
    """Return a copy of the last-run summary (thread-safe)."""
    with _lock:
        return dict(_last_run)


def trigger_now():
    """
    Run the reconciliation job immediately (outside the normal schedule).
    Non-blocking: the job runs in the scheduler's thread pool and this
    function returns straight away.
    """
    if _scheduler is not None:
        _scheduler.add_job(
            _run_reconciliation,
            id="manual_trigger",
            replace_existing=True,
            max_instances=1,
        )
    else:
        # Scheduler not started yet — run in a plain thread
        t = threading.Thread(target=_run_reconciliation, daemon=True)
        t.start()


def start_scheduler(interval_minutes: int = None) -> BackgroundScheduler:
    """
    Create and start the APScheduler background scheduler.

    Called ONCE from app.py at startup (guarded by the werkzeug reloader
    check so it doesn't double-start in debug mode).

    Returns the scheduler instance so app.py can shut it down cleanly on
    application exit if needed.
    """
    global _scheduler

    import os
    minutes = interval_minutes or int(
        os.environ.get("SCHEDULER_INTERVAL_MINUTES", INTERVAL_MINUTES)
    )

    if _scheduler is not None and _scheduler.running:
        logger.info("[scheduler] Already running — skipping start.")
        return _scheduler

    _scheduler = BackgroundScheduler(
        job_defaults={"max_instances": 1, "misfire_grace_time": 60},
        timezone="UTC",
    )
    _scheduler.add_job(
        _run_reconciliation,
        trigger=IntervalTrigger(minutes=minutes),
        id="scheduled_reconciliation",
        name=f"Auto-reconcile every {minutes} min",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info(
        "[scheduler] Started — will auto-reconcile every %d minute(s).", minutes
    )
    return _scheduler


def stop_scheduler():
    """Gracefully stop the scheduler (called on app shutdown)."""
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("[scheduler] Stopped.")
