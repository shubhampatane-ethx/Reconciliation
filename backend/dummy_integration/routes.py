"""
=====================================================================
 dummy_integration  ->  routes.py
=====================================================================
NEW FILE — Phase 1 addition.

Purpose:
    "API layer" for the new workflow. Exposes ONE new endpoint on the
    EXISTING Flask backend:

        POST /api/dummy-integration/source-upload

    which implements steps 1-9 of the requested workflow:

        1. User uploads only the Source Excel/CSV file.
        2. Backend reads the uploaded file.
        3. Store the uploaded rows into PostgreSQL Source Staging.
        4. Detect the Business Key / Primary Key.
     -> 5. Call the Dummy Server API.
        6. (Dummy Server connects to PostgreSQL.)
        7. (Dummy Server fetches Target data.)
        8. (Dummy Server returns Target data as JSON.)
        9. Log the response here (NOT passed into reconciliation yet).

    This blueprint is registered from the existing backend/app.py with
    a couple of additive lines (see the "PHASE 1" block near the
    bottom of that file) — no existing route, function, or import in
    app.py is changed.

    This file intentionally does NOT import anything from the existing
    app.py (no shared state, no circular imports, no risk of touching
    the reconciliation/comparison/report code at all).
=====================================================================
"""

import io
import os

import pandas as pd
from flask import Blueprint, request, jsonify, g

from auth import optional_auth
from dummy_integration.business_key import detect_business_key
from dummy_integration.dummy_client import fetch_target_data, fetch_target_projects
from dummy_integration.staging_db import init_staging_schema, new_batch_id, save_uploaded_rows

# Blueprint is mounted under /api/dummy-integration so its routes can
# never collide with any existing /api/... route in app.py.
dummy_integration_bp = Blueprint("dummy_integration", __name__, url_prefix="/api/dummy-integration")

_ALLOWED_EXTENSIONS = {"csv", "xlsx", "xls"}


@dummy_integration_bp.route("/target-schema", methods=["GET"])
def target_schema():
    """
    NEW -- Schema Mapping modal support.

    The frontend's Schema Mapping modal (SchemaMappingModal.jsx) needs to
    show the REAL Target column names for whichever project_name the user
    picked, so the "Target Key Column" dropdown and per-row mapping table
    list actual Target fields (e.g. "Project Name", "Project Number",
    "Customer") instead of columns from an unrelated entity.

    Previously the frontend called this exact URL but no matching route
    existed here, so every request 404'd, was swallowed by the frontend's
    try/catch, and the UI silently fell back to a stale/unrelated column
    list left over from a different upload — which is what produced a
    Target dropdown full of columns (e.g. PARTY_NAME, PARTY_SITE_ID) that
    had nothing to do with the selected project's actual Target schema.

    Query params (both optional, mirror /target-data):
        project_name  which client's Target table to read from
        entity_name   narrow to one entity/table if the project has more
                       than one

    Returns: {"columns": [...], "project_name": ..., "entity_name": ...,
              "total_records": N}
    Column order follows first-seen order across a sample of rows (target
    rows can have sparsely-populated / optional fields, so we union keys
    across several rows rather than trusting just the first one).
    """
    project_name = request.args.get("project_name")
    entity_name = request.args.get("entity_name")

    target_response = fetch_target_data(project_name=project_name, entity_name=entity_name)
    rows = target_response.get("data", [])

    if not rows:
        return jsonify({
            "columns": [],
            "project_name": project_name,
            "entity_name": entity_name,
            "total_records": 0,
            "error": target_response.get("error"),
        }), (502 if target_response.get("error") else 200)

    seen_cols = []
    seen_set = set()
    for item in rows[:50]:
        for key in (item.get("row_data") or {}).keys():
            if key not in seen_set:
                seen_set.add(key)
                seen_cols.append(key)

    return jsonify({
        "columns": seen_cols,
        "project_name": project_name,
        "entity_name": entity_name or rows[0].get("entity_name"),
        "total_records": target_response.get("total_records", len(rows)),
    })


@dummy_integration_bp.route("/target-projects", methods=["GET"])
def target_projects():
    """
    NEW -- Multi-target addition. Proxies the Dummy Server's
    GET /target-projects so the frontend (which only talks to this
    Flask backend, never directly to the Dummy Server) can populate a
    "which target dataset?" dropdown (CJBS / Etairos / Airetech / ATS)
    before calling /auto-reconcile with a specific project_name.
    """
    return jsonify(fetch_target_projects())


def _read_uploaded_file(file_storage) -> pd.DataFrame:
    """
    Minimal, self-contained CSV/Excel reader for THIS module only.

    Deliberately NOT reusing the existing app.py's read_dataframe() /
    normalize_dataframe() helpers, so this module has zero coupling to
    (and zero risk of ever breaking) the existing reconciliation code.
    """
    filename = file_storage.filename or ""
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content = file_storage.read()

    if extension == "csv":
        return pd.read_csv(io.BytesIO(content))
    elif extension in ("xlsx", "xls"):
        return pd.read_excel(io.BytesIO(content))
    else:
        raise ValueError("Allowed file types: csv, xls, xlsx.")


@dummy_integration_bp.route("/source-upload", methods=["POST"])
@optional_auth
def source_upload():
    """
    Phase 1 endpoint: upload a Source file, stage it, detect its
    business key, then fetch (and log) Target data from the Dummy
    Server. Does NOT run reconciliation/comparison — that stays exactly
    as it already is elsewhere in this backend.

    Form fields:
        file          (required) the Source Excel/CSV file
        project_name  (optional) which client this belongs to
        entity_name   (optional) what kind of file this is (e.g. "customer")
    """
    if "file" not in request.files:
        return jsonify({"error": "Please upload a file as 'file'."}), 400

    uploaded = request.files["file"]
    if uploaded.filename == "" or "." not in uploaded.filename or \
            uploaded.filename.rsplit(".", 1)[1].lower() not in _ALLOWED_EXTENSIONS:
        return jsonify({"error": "Allowed file types: csv, xls, xlsx."}), 400

    project_name = request.form.get("project_name", "default_project")
    entity_name = request.form.get("entity_name") or uploaded.filename.rsplit(".", 1)[0]

    # --- Step 2: read the uploaded file -----------------------------------
    try:
        df = _read_uploaded_file(uploaded)
    except Exception as exc:
        return jsonify({"error": f"Could not read file: {str(exc)}"}), 400

    if df.empty:
        return jsonify({"error": "Uploaded file has no rows."}), 400

    # --- Step 4: detect the business key ------------------------------------
    # (Detected before staging so the key column name can be stored
    # alongside every row for this batch.)
    business_key = detect_business_key(df)

    user_id = getattr(g, 'current_user_id', None)

    # --- Step 3: store uploaded rows into PostgreSQL Source Staging --------
    init_staging_schema()  # idempotent — safe to call on every request
    batch_id = new_batch_id()
    # NaN isn't valid JSON — swap it for None so JSONB storage never breaks.
    records = df.where(pd.notnull(df), None).to_dict(orient="records")
    rows_stored = save_uploaded_rows(
        records=records,
        project_name=project_name,
        entity_name=entity_name,
        business_key=business_key,
        batch_id=batch_id,
        user_id=user_id,
    )

    # --- Steps 5-8: call the Dummy Server, which itself talks to Postgres --
    target_response = fetch_target_data(project_name=project_name, entity_name=entity_name)

    # --- Step 9: STOP HERE. Target JSON is only logged/returned, never -----
    # passed into the existing comparison/reconciliation logic in this phase.
    return jsonify({
        "batch_id": batch_id,
        "project_name": project_name,
        "entity_name": entity_name,
        "business_key": business_key,
        "source_rows_staged": rows_stored,
        "dummy_server": target_response,
        "note": "Phase 1 only — target data was fetched and logged, "
                "not yet passed into reconciliation.",
    }), 201


# =============================================================================
# PHASE 2 ADDITION — automated end-to-end reconciliation
# =============================================================================
# NEW ENDPOINT (added on top of everything above — nothing above this line
# was changed):
#
#     POST /api/dummy-integration/auto-reconcile
#
# This is what makes the workflow fully automatic: the user uploads ONLY
# the Source file; this endpoint reads it, detects the business key, calls
# the Dummy Server for Target data, and THEN feeds both dataframes into
# your EXISTING, UNCHANGED comparison engine (difference_summary /
# extract_day_summary / generate_plain_english_summary / the Series
# storage functions — all imported straight from app.py / storage.py /
# insights.py, not reimplemented here).
#
# It stores the result as a normal Series (Version 0 = Source,
# Version 1 = Target fetched from the Dummy Server), so the comparison
# shows up in the existing "Reconcile Over Time", "Stored Files", and
# "Reports" screens exactly like a manual two-file comparison would —
# no changes needed to those screens or to the comparison logic itself.
# =============================================================================

def _target_rows_to_dataframe(target_json: dict):
    """
    Flatten the Dummy Server's response (`{"total_records": N, "data": [
    {"row_data": {...}, ...}, ...]}`) into a plain pandas DataFrame with
    real columns — the shape difference_summary()/extract_day_summary()
    (in app.py) already expect, same as any uploaded Excel/CSV file.
    """
    import pandas as pd
    rows = [item.get("row_data", {}) for item in target_json.get("data", [])]
    return pd.DataFrame(rows)


@dummy_integration_bp.route("/auto-reconcile", methods=["POST"])
@optional_auth
def auto_reconcile():
    """
    Phase 2 endpoint: upload ONLY a Source file. Everything else —
    business key detection, staging, calling the Dummy Server, fetching
    Target data, and running the comparison — happens automatically.

    Form fields:
        file          (required) the Source Excel/CSV file
        name          (optional) name for the resulting comparison/series
        project_name  (optional) which client this belongs to
        entity_name   (optional) what kind of file this is (e.g. "customer")
        key_columns   (optional) comma-separated override for the columns
                      to match Source/Target rows on. If omitted, the
                      auto-detected business key is used (falling back to
                      the existing app's own column-guessing logic).
    """
    # Imported here (not at module load time) so this module stays fully
    # decoupled from app.py at import time — app.py only becomes fully
    # loaded (and these names available) once the Flask app has finished
    # starting up, which is guaranteed by the time any request arrives.
    from app import (
        read_dataframe, normalize_dataframe, allowed_file, guess_key_columns,
        difference_summary, extract_day_summary, align_equivalent_columns, resolve_data_type,
        apply_manual_schema_mapping, _parse_schema_mapping_form,
        fuzzy_align_remaining_columns, explicitly_ignored_source_columns,
    )
    from insights import generate_plain_english_summary
    from storage import (
        create_series, add_series_version, save_series_diff_json,
        store_series_excel_report, store_file,
    )
    import db as db_module
    import pandas as pd
    import logging as _logging
    _log = _logging.getLogger("dummy_integration.auto_reconcile")

    # Same ownership pattern as series_create()/series_add_version() in
    # app.py: attaches the series to the logged-in user when a JWT is
    # present, works anonymously otherwise (optional_auth never blocks).
    user_id = getattr(g, 'current_user_id', None)

    if "file" not in request.files:
        return jsonify({"error": "Please upload a Source file as 'file'."}), 400

    source_file = request.files["file"]
    if source_file.filename == "" or not allowed_file(source_file.filename):
        return jsonify({"error": "Allowed file types: csv, xls, xlsx."}), 400

    project_name = request.form.get("project_name", "default_project")
    entity_name = request.form.get("entity_name") or source_file.filename.rsplit(".", 1)[0]
    series_name = request.form.get("name", "").strip()
    manual_key_columns = request.form.get("key_columns", "").strip()

    try:
        # --- Step 1-2: read the Source file, same reader the rest of the app uses ---
        try:
            df_source = normalize_dataframe(read_dataframe(source_file))
        except Exception as exc:
            return jsonify({"error": f"Could not read file: {str(exc)}"}), 400

        if df_source.empty:
            return jsonify({"error": "Uploaded file has no rows."}), 400

        # --- Strip empty/unnamed columns from Source ---
        # Excel files often have trailing blank columns that pandas reads as
        # "Unnamed: 18", "Unnamed: 19" etc. These don't exist in the target DB
        # table, causing every column to show as "source-only" and matched=0.
        # Drop any column whose name starts with "Unnamed:" OR whose entire
        # column is null/empty.
        unnamed_cols = [c for c in df_source.columns if str(c).startswith("Unnamed:")]
        if unnamed_cols:
            df_source = df_source.drop(columns=unnamed_cols)
            _log.info("Dropped %d unnamed columns from source: %s", len(unnamed_cols), unnamed_cols)
        # Also drop columns that are 100% empty (all NaN)
        df_source = df_source.dropna(axis=1, how="all")

        # Check if asynchronous processing via Kafka is requested
        is_async = request.form.get("async", "false").lower() in ("true", "1")
        if is_async:
            job_id = f"job_{os.urandom(8).hex()}"
            src_meta = store_file(source_file.filename, df_source, "source_upload", user_id=user_id)

            db_module.create_recon_job(
                job_id=job_id,
                user_id=user_id,
                job_type="DUMMY_AUTO_RECONCILE",
                status="QUEUED_KAFKA",
                source_filename=source_file.filename,
                target_filename=f"dummy-server:{project_name}/{entity_name}",
                payload_params={
                    "project_name": project_name,
                    "entity_name": entity_name,
                    "name": series_name,
                    "key_columns": manual_key_columns,
                    "schema_mapping": request.form.get("schema_mapping"),
                    "amount_source_col": request.form.get("amount_source_col"),
                    "amount_target_col": request.form.get("amount_target_col"),
                    "data_type": request.form.get("data_type"),
                },
            )

            try:
                from kafka_service import publish_recon_job, publish_audit_event
                kafka_sent = publish_recon_job(job_id, {
                    "job_id": job_id,
                    "job_type": "DUMMY_AUTO_RECONCILE",
                    "user_id": user_id,
                    "source_file_id": src_meta["file_id"],
                    "source_filename": source_file.filename,
                    "project_name": project_name,
                    "entity_name": entity_name,
                    "name": series_name,
                    "key_columns": manual_key_columns,
                    "schema_mapping": request.form.get("schema_mapping"),
                    "amount_source_col": request.form.get("amount_source_col"),
                    "amount_target_col": request.form.get("amount_target_col"),
                    "data_type": request.form.get("data_type"),
                })
                publish_audit_event("DUMMY_RECON_QUEUED", {"job_id": job_id, "kafka_sent": kafka_sent}, user_id=user_id)
            except Exception as kafka_ex:
                _log.warning("Could not publish DUMMY_AUTO_RECONCILE job to Kafka: %s", kafka_ex)
                kafka_sent = False

            return jsonify({
                "job_id": job_id,
                "status": "QUEUED_KAFKA" if kafka_sent else "QUEUED_FALLBACK",
                "message": "Reconciliation job submitted to Kafka workers.",
                "async": True,
            }), 202

        # --- Step 3-4: detect business key + stage the Source rows (Phase 1 logic, reused) ---
        detected_business_key = detect_business_key(df_source)
        batch_id = new_batch_id()
        try:
            init_staging_schema()
            records = df_source.where(pd.notnull(df_source), None).to_dict(orient="records")
            save_uploaded_rows(
                records=records, project_name=project_name, entity_name=entity_name,
                business_key=detected_business_key, batch_id=batch_id, user_id=user_id,
            )
        except Exception as staging_exc:
            # Source staging is optional infrastructure (requires the consistency DB).
            # If it's not available, log and continue — reconciliation still works
            # using Target_Data and the existing file-based storage.
            _log.warning("Source staging skipped (DB unavailable): %s", staging_exc)

        # --- Step 5-8: call the Dummy Server, which reads Target data from Postgres ---
        target_response = fetch_target_data(project_name=project_name, entity_name=entity_name)
        df_target = _target_rows_to_dataframe(target_response)

        if df_target.empty:
            return jsonify({
                "error": f"No target data was returned for project_name={project_name!r} — "
                         "nothing to reconcile against.",
                "project_name": project_name,
                "entity_name": entity_name,
                "batch_id": batch_id,
                "hint": (
                    "Make sure the Dummy Server is running (`uvicorn dummy_server.app:app "
                    "--host 0.0.0.0 --port 9000` from the backend/ directory), that "
                    "DUMMY_SERVER_DATABASE_URL in backend/.env points to your Target_Data "
                    "database, and that its target table has rows — run "
                    "`docker compose run --rm target_db_seed` (or "
                    "`python -m dummy_server.seed_targets`) to (re)seed CJBS, Etairos, "
                    "Airetech, and ATS target tables. GET /api/dummy-integration/target-projects "
                    "lists the valid project_name values."
                ),
            }), 502
        df_target = normalize_dataframe(df_target)

        # Strip unnamed/empty columns from target too (defensive)
        unnamed_target = [c for c in df_target.columns if str(c).startswith("Unnamed:")]
        if unnamed_target:
            df_target = df_target.drop(columns=unnamed_target)
        df_target = df_target.dropna(axis=1, how="all")

        # Manual mapping from the Schema Mapping modal (if the user configured
        # one) always wins over the automatic heuristic below, for whichever
        # columns it covers.
        manual_mapping = _parse_schema_mapping_form(request.form)
        df_target, _manual_renames = apply_manual_schema_mapping(df_target, manual_mapping)

        # GENERIC fix (works for any op-co, not just one): rename Target
        # columns that are the same field as a Source column but styled
        # differently (e.g. 'PartyNumber' vs 'PARTY_NUMBER') onto Source's
        # naming, so exact-name key detection below finds them as shared
        # instead of treating them as unrelated columns.
        df_target, _col_alignments = align_equivalent_columns(df_source, df_target)

        # Third tier: anything still unmatched (and not explicitly skipped
        # by the user) gets a best-effort fuzzy/substring match -- e.g.
        # 'Address1_original' -> 'ADDRESS1' -- instead of staying "Ignored"
        # just because it didn't normalise to an exact match.
        df_target, _fuzzy_renames = fuzzy_align_remaining_columns(
            df_source, df_target, excluded_source_cols=explicitly_ignored_source_columns(manual_mapping)
        )

        # --- Determine key columns to match Source/Target rows on ---
        if manual_key_columns:
            raw_keys = [c.strip() for c in manual_key_columns.split(",") if c.strip()]
            resolved_keys = []
            for k in raw_keys:
                if k in df_source.columns and k in df_target.columns:
                    resolved_keys.append(k)
                else:
                    mapped_src = None
                    for sc, tc in (manual_mapping or {}).items():
                        if tc == k:
                            mapped_src = sc
                            break
                    if mapped_src and mapped_src in df_source.columns and mapped_src in df_target.columns:
                        resolved_keys.append(mapped_src)
                    elif k in df_source.columns:
                        resolved_keys.append(k)
            key_columns = resolved_keys if resolved_keys else [raw_keys[0]]
        elif detected_business_key and detected_business_key in df_source.columns and detected_business_key in df_target.columns:
            key_columns = [detected_business_key]
        else:
            # Falls back to the existing app's own heuristic if the two sides
            # don't share the detected key's exact column name.
            key_columns = guess_key_columns(df_source, df_target)

        if not key_columns:
            return jsonify({"error": "Could not determine a matching key column between "
                                      "Source and Target data."}), 400
        # Tolerant validation (same fix as series_add_version()/reconcile() in app.py):
        # if the key column only exists on one side, add it as an empty column on
        # the other rather than hard-failing — those rows correctly show up as
        # all-Added or all-Deleted, which is the right result for a genuine
        # schema mismatch between Source and this op-co's Target data.
        for col in key_columns:
            if col not in df_source.columns and col not in df_target.columns:
                return jsonify({"error": f"Key column '{col}' was not found in either "
                                          f"Source or Target data."}), 400
            if col not in df_source.columns:
                df_source[col] = ""
            if col not in df_target.columns:
                df_target[col] = ""

        # Preserve repeated document/invoice keys when this is a transaction extract.
        try:
            data_type = resolve_data_type(request.form.get("data_type"), df_source, df_target, key_columns)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        diff_report = difference_summary(df_source, df_target, key_columns, data_type)
        day_summary = extract_day_summary(df_source, df_target, key_columns, diff_report)

        source_label = "Source"
        target_label = "Target (Dummy Server)"
        insights = generate_plain_english_summary(diff_report, day_summary, key_columns, source_label, target_label)

        diff_summary = {
            "data_type": data_type,
            "added": diff_report["missing_in_source"]["count"],
            "deleted": diff_report["missing_in_target"]["count"],
            "duplicates": diff_report["duplicates_source"]["count"] + diff_report["duplicates_target"]["count"],
            "updated": diff_report["mismatches"]["count"],
            "renamed": diff_report["fuzzy_matches"]["count"],
            "format_issues": diff_report["format_inconsistencies"]["count"],
            "compared_against_version": 0,
            "compared_against_label": source_label,
        }
        diff_report["day_summary"] = day_summary
        diff_report["insights"] = insights
        diff_report["schema_mapping"] = manual_mapping

        # --- Persist as a normal 2-version Series, exactly like a manual comparison ---
        series = create_series(series_name, source_file.filename, df_source, user_id=user_id, data_type=data_type)
        series_id = series["series_id"]
        db_module.upsert_series_metadata(series_id, series["name"], user_id=user_id)
        # Mirrors series_create()'s dataset registration in app.py, so an
        # auto-reconciled series shows up in "Datasets" exactly like a
        # manually-uploaded one does.
        db_module.upsert_dataset(
            dataset_id=series_id,
            dataset_name=series["name"],
            original_file_name=source_file.filename,
            user_id=user_id,
            record_count=int(len(df_source)),
            file_type=source_file.filename.rsplit(".", 1)[-1].lower(),
            column_names=list(df_source.columns),
        )

        diff_report_filename = save_series_diff_json(series_id, 1, diff_report)
        excel_report_info = store_series_excel_report(
            series_id, series["name"], source_label, target_label, 1,
            diff_report, key_columns, day_summary,
        )
        version_entry = add_series_version(
            series_id, f"dummy-server:{project_name}/{entity_name}", df_target, key_columns,
            diff_summary, excel_report_info["report_file"], label=target_label, data_type=data_type,
        )
        db_module.upsert_series_metadata(series_id, series["name"], key_columns, user_id=user_id)
        db_module.upsert_series_version(
            series_id, 1, target_label, f"dummy-server:{project_name}/{entity_name}",
            int(len(df_target)), int(len(df_target.columns)), key_columns, diff_summary,
            excel_report_info["report_file"],
        )
        db_module.save_row_snapshot(series_id, 0, key_columns, df_source)
        db_module.save_row_snapshot(series_id, 1, key_columns, df_target)

        return jsonify({
            "series_id": series_id,
            "version": version_entry,
            "batch_id": batch_id,
            "business_key": detected_business_key,
            "key_columns": key_columns,
            "data_type": data_type,
            "compared_against_version": 0,
            "report": diff_report,
            "day_summary": day_summary,
            "insights": insights,
            "diff_report_file": diff_report_filename,
            "excel_report_file": excel_report_info["report_file"],
            "dummy_server_records_fetched": target_response.get("total_records", 0),
        }), 201

    except Exception as exc:
        _log.exception("Unhandled error in auto_reconcile")
        return jsonify({
            "error": f"Auto-reconcile failed: {str(exc)}",
            "hint": "Check the Flask server console for the full traceback.",
        }), 500


# =============================================================================
# SCHEDULER ENDPOINTS
# =============================================================================
# Three additive endpoints — nothing above this block was changed.
#
#   GET  /api/dummy-integration/scheduler/status
#        Returns scheduler running state + last-run summary (matched/added/
#        deleted/updated counts, insights, timestamps, any error).
#
#   POST /api/dummy-integration/scheduler/trigger
#        Fires the reconciliation job immediately without waiting for the
#        next 10-minute tick.  Returns the same status shape.
#
#   GET  /api/dummy-integration/scheduler/last-result
#        Returns the full diff_report from the most recent successful run
#        (series_id + version), so the frontend can render it exactly like
#        a normal manual reconciliation result.
# =============================================================================

@dummy_integration_bp.route("/scheduler/status", methods=["GET"])
def scheduler_status():
    """
    Return the current state of the background scheduler and the last-run
    summary (counts + insights).  Safe to poll frequently — no DB hit.
    """
    try:
        from dummy_integration.scheduler import get_last_run, _scheduler, INTERVAL_MINUTES
        import os

        interval = int(os.environ.get("SCHEDULER_INTERVAL_MINUTES", INTERVAL_MINUTES))
        running = _scheduler is not None and _scheduler.running

        next_run = None
        if running and _scheduler is not None:
            job = _scheduler.get_job("scheduled_reconciliation")
            if job and job.next_run_time:
                next_run = job.next_run_time.isoformat()

        return jsonify({
            "scheduler_running": running,
            "interval_minutes": interval,
            "next_run_at": next_run,
            "last_run": get_last_run(),
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@dummy_integration_bp.route("/scheduler/trigger", methods=["POST"])
def scheduler_trigger():
    """
    Manually fire the reconciliation job right now (non-blocking).
    The job runs in the scheduler's thread pool; this endpoint returns
    immediately with the *previous* last-run state plus a triggered flag.
    Poll /scheduler/status to watch it complete.
    """
    try:
        from dummy_integration.scheduler import trigger_now, get_last_run
        trigger_now()
        return jsonify({
            "triggered": True,
            "message": "Reconciliation job has been queued — poll /scheduler/status for the result.",
            "previous_run": get_last_run(),
        }), 202
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@dummy_integration_bp.route("/scheduler/last-result", methods=["GET"])
def scheduler_last_result():
    """
    Return the full diff report from the most recent successful scheduled
    run.  Loads the persisted JSON from disk (same format as the manual
    /api/series/<id>/versions/<v>/report endpoint) so the frontend can
    render it without any extra changes.

    Query params:
        include_rows  (default true)  — set to 'false' to get counts only
                                        without the full row-level detail.
    """
    try:
        from dummy_integration.scheduler import get_last_run
        from storage import load_series_diff_json

        last = get_last_run()

        if last["status"] not in ("success",):
            return jsonify({
                "available": False,
                "status": last["status"],
                "error": last.get("error"),
                "message": "No successful scheduled run yet.",
            }), 404

        series_id = last["series_id"]
        version   = last["version"]

        report = load_series_diff_json(series_id, version)
        if report is None:
            return jsonify({
                "available": False,
                "status": "error",
                "message": "Run completed but report file could not be found on disk.",
            }), 404

        include_rows = request.args.get("include_rows", "true").lower() != "false"
        if not include_rows:
            # Strip row-level arrays — return counts only for lightweight polling
            slim = {
                k: ({"count": v["count"]} if isinstance(v, dict) and "rows" in v else v)
                for k, v in report.items()
            }
            report = slim

        return jsonify({
            "available": True,
            "series_id": series_id,
            "version": version,
            "finished_at": last["finished_at"],
            "summary": {
                "matched":         last["matched"],
                "added":           last["added"],
                "deleted":         last["deleted"],
                "updated":         last["updated"],
                "source_records":  last["source_records"],
                "target_records":  last["target_records"],
                "key_columns":     last["key_columns"],
                "project_name":    last["project_name"],
                "entity_name":     last["entity_name"],
            },
            "insights": last["insights"],
            "report": report,
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
