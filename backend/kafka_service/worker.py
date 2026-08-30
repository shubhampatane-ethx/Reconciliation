"""
Kafka Reconciliation Background Worker Daemon.

Consumes reconciliation jobs from `recon.jobs.queued` and ERP sync events from `erp.sync.events`,
executes high-performance matching engines, updates PostgreSQL job tracking, and publishes
completion and audit telemetry.
"""

import io
import json
import logging
import os
import sys
import time
import traceback
from typing import Any, Dict

# Ensure backend root is on sys.path
_current_dir = os.path.dirname(os.path.abspath(__file__))
_backend_root = os.path.abspath(os.path.join(_current_dir, ".."))
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)

import pandas as pd
import numpy as np

import db
from storage import get_file_chunks, store_file
from ar_column_mapper import _load_synonyms, load_and_map
from ar_reconcile import reconcile as ar_reconcile_engine
from ar_pagination import store_job, paginate_list, DEFAULT_PAGE_SIZE, ALLOWED_PAGE_SIZES

from .config import (
    KAFKA_BOOTSTRAP_SERVERS,
    KAFKA_CLIENT_ID,
    KAFKA_CONSUMER_GROUP,
    TOPIC_ERP_SYNC_EVENTS,
    TOPIC_RECON_JOBS_QUEUED,
    TOPIC_RECON_NOTIFICATIONS,
    ensure_topics_exist,
)
from .producer import publish_audit_event, publish_recon_completed, publish_notification_event

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [KafkaWorker] %(message)s",
)
logger = logging.getLogger("kafka_worker")


def _sanitize(obj: Any) -> Any:
    """Recursively convert pandas/numpy non-JSON-safe types to Python natives."""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, pd.Timestamp):
        return None if pd.isna(obj) else obj.isoformat()
    if isinstance(obj, float) and (pd.isna(obj) or np.isnan(obj)):
        return None
    if obj is pd.NaT:
        return None
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return None if np.isnan(obj) else float(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def _dataframe_from_file_id(file_id: str) -> pd.DataFrame:
    """Reconstructs DataFrame from storage cache (CSV or chunks)."""
    csv_file = os.path.join(_backend_root, "vector_store", f"{file_id}.csv")
    if os.path.exists(csv_file):
        return pd.read_csv(csv_file, dtype=str).fillna("")

    file_data = get_file_chunks(file_id)
    if not file_data:
        raise ValueError(f"Stored file '{file_id}' not found in storage cache.")
    
    chunks = file_data.get("chunks", [])
    rows = []
    for chunk in chunks:
        text = chunk.get("text", "")
        parts = text.strip().split("\n", 1)
        if len(parts) == 2:
            row_text = parts[1]
            record = {}
            for item in row_text.split("; "):
                if ": " in item:
                    col, val = item.split(": ", 1)
                    record[col.strip()] = val.strip()
            if record:
                rows.append(record)
    
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)


def process_ar_reconciliation_job(job_id: str, payload: Dict[str, Any]):
    """Processes an asynchronous AR reconciliation task."""
    logger.info(f"Starting AR Reconciliation for Job ID: {job_id}")
    user_id = payload.get("user_id")
    db.update_recon_job_status(job_id, status="PROCESSING", progress_pct=10.0)

    try:
        source_file_id = payload.get("source_file_id")
        target_file_id = payload.get("target_file_id")
        overrides = payload.get("overrides", {})
        src_overrides = overrides.get("source", {})
        tgt_overrides = overrides.get("target", {})
        tolerance = float(payload.get("tolerance", 0.01))

        db.update_recon_job_status(job_id, status="PROCESSING", progress_pct=25.0)

        # Ingest files
        df_source = _dataframe_from_file_id(source_file_id)
        df_target = _dataframe_from_file_id(target_file_id)

        db.update_recon_job_status(job_id, status="PROCESSING", progress_pct=45.0)

        # Dynamic Schema Mapping
        synonyms_all = _load_synonyms()
        txn_fields = synonyms_all.get("transactional", {})

        src_std, src_mapping, src_report = load_and_map(df_source, txn_fields, src_overrides)
        tgt_std, tgt_mapping, tgt_report = load_and_map(df_target, txn_fields, tgt_overrides)

        db.update_recon_job_status(job_id, status="PROCESSING", progress_pct=70.0)

        # Execution Engine
        results = ar_reconcile_engine(src_std, tgt_std, tolerance=tolerance)

        buckets = {
            "matched": results["matched_rows"],
            "disputed": results["mismatch_rows"],
            "unmatched_source": results["only_source_rows"],
            "unmatched_target": results["only_target_rows"],
            "tier2_rows": results["tier2_rows"],
            "duplicate_source_rows": results["duplicate_source_rows"],
            "duplicate_target_rows": results["duplicate_target_rows"],
            "source_exceptions": results["source_exceptions"],
            "target_exceptions": results["target_exceptions"],
        }
        sanitized_buckets = {k: _sanitize(v) for k, v in buckets.items()}
        
        # Store in pagination cache with identical job_id
        store_job(sanitized_buckets, meta={"summary": results["summary"]}, job_id=job_id)

        first_pages = {
            name: paginate_list(rows, page=1, page_size=DEFAULT_PAGE_SIZE)
            for name, rows in sanitized_buckets.items()
        }

        result_payload = _sanitize({
            "job_id": job_id,
            "summary": results["summary"],
            "source_mapping": src_report,
            "target_mapping": tgt_report,
            "results": first_pages,
            "page_size": DEFAULT_PAGE_SIZE,
            "allowed_page_sizes": list(ALLOWED_PAGE_SIZES),
        })

        db.update_recon_job_status(
            job_id,
            status="COMPLETED",
            progress_pct=100.0,
            result_summary=result_payload,
        )

        publish_recon_completed(job_id, result_payload)
        summ = results.get("summary") or {}
        ar_details = (
            f"Your Transaction Reconciliation job completed successfully.\n\n"
            f"Reconciliation Summary:\n"
            f"----------------------------------------\n"
            f"- Source Records: {summ.get('source_records', 0)}\n"
            f"- Target Records: {summ.get('target_records', 0)}\n"
            f"- Matched: {summ.get('matched', 0)}\n"
            f"- Amount Mismatches: {summ.get('amount_mismatch', 0)}\n"
            f"- Only in Source: {summ.get('only_in_source', 0)}\n"
            f"- Only in Target: {summ.get('only_in_target', 0)}\n"
            f"- Tier-2 Matches: {summ.get('tier2_matches', 0)}\n"
            f"- Duplicates: {summ.get('duplicate_keys_source', 0) + summ.get('duplicate_keys_target', 0)}\n"
            f"- Exceptions: {summ.get('source_exceptions', 0) + summ.get('target_exceptions', 0)}"
        )
        publish_notification_event(
            job_id=job_id,
            user_id=user_id,
            status="COMPLETED",
            details=ar_details,
        )
        publish_audit_event(
            "AR_RECON_COMPLETED",
            {"job_id": job_id, "summary": results["summary"]},
            user_id=user_id,
        )
        logger.info(f"Successfully finished AR Reconciliation Job: {job_id}")

    except Exception as exc:
        err_msg = f"{str(exc)}\n{traceback.format_exc()}"
        logger.error(f"Error executing Job {job_id}: {err_msg}")
        db.update_recon_job_status(
            job_id,
            status="FAILED",
            progress_pct=100.0,
            error_message=str(exc),
        )
        publish_notification_event(
            job_id=job_id,
            user_id=user_id,
            status="FAILED",
            details=f"Your transaction reconciliation job {job_id} failed: {str(exc)}.",
        )
        publish_audit_event(
            "AR_RECON_FAILED",
            {"job_id": job_id, "error": str(exc)},
            user_id=user_id,
        )


def process_dummy_reconcile_job(job_id: str, payload: Dict[str, Any]):
    """Processes an asynchronous auto-reconcile job against the Dummy Server."""
    logger.info(f"Starting DUMMY_AUTO_RECONCILE for Job ID: {job_id}")
    user_id = payload.get("user_id")
    db.update_recon_job_status(job_id, status="PROCESSING", progress_pct=10.0)

    try:
        from app import (
            normalize_dataframe, guess_key_columns, difference_summary,
            extract_day_summary, align_equivalent_columns, resolve_data_type,
            apply_manual_schema_mapping, fuzzy_align_remaining_columns
        )
        from insights import generate_plain_english_summary
        from storage import (
            create_series, add_series_version, save_series_diff_json,
            store_series_excel_report
        )
        from dummy_integration.business_key import detect_business_key

        source_file_id = payload.get("source_file_id")
        source_filename = payload.get("source_filename", "src.csv")
        project_name = payload.get("project_name", "default_project")
        entity_name = payload.get("entity_name") or source_filename.rsplit(".", 1)[0]
        series_name = payload.get("name") or f"Auto_{project_name}_{int(time.time())}"
        manual_key_columns = payload.get("key_columns", "").strip()
        manual_mapping_raw = payload.get("schema_mapping")
        manual_mapping = {}
        if manual_mapping_raw:
            try:
                manual_mapping = json.loads(manual_mapping_raw)
            except Exception:
                pass

        amount_source_col = payload.get("amount_source_col")
        amount_target_col = payload.get("amount_target_col")
        req_data_type = payload.get("data_type")

        # Step 1: Read source cached CSV
        df_source = _dataframe_from_file_id(source_file_id)

        # Step 2: Fetch target data from Dummy Server
        db.update_recon_job_status(job_id, status="PROCESSING", progress_pct=25.0)
        from dummy_integration.dummy_client import fetch_target_data
        target_response = fetch_target_data(project_name=project_name, entity_name=entity_name)
        
        from dummy_integration.routes import _target_rows_to_dataframe
        df_target = _target_rows_to_dataframe(target_response)
        if df_target.empty:
            raise ValueError(f"No target data returned from Dummy Server for project={project_name}.")

        df_target = normalize_dataframe(df_target)
        unnamed_target = [c for c in df_target.columns if str(c).startswith("Unnamed:")]
        if unnamed_target:
            df_target = df_target.drop(columns=unnamed_target)
        df_target = df_target.dropna(axis=1, how="all")

        # Step 3: Column Mapping & Alignments
        db.update_recon_job_status(job_id, status="PROCESSING", progress_pct=45.0)
        df_target, _manual_renames = apply_manual_schema_mapping(df_target, manual_mapping)
        df_target, _col_alignments = align_equivalent_columns(df_source, df_target)
        
        # Exclude source cols that are explicitly ignored from manual mapping
        from app import explicitly_ignored_source_columns
        ignored_cols = explicitly_ignored_source_columns(manual_mapping)
        df_target, _fuzzy_renames = fuzzy_align_remaining_columns(
            df_source, df_target, excluded_source_cols=ignored_cols
        )

        if manual_key_columns:
            raw_keys = [c.strip() for c in manual_key_columns.split(",") if c.strip()]
            resolved_keys = []
            for k in raw_keys:
                if k in df_source.columns and k in df_target.columns:
                    resolved_keys.append(k)
                else:
                    # Check if k was a target column mapped to a source column in manual_mapping
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
        else:
            detected_business_key = payload.get("business_key") or detect_business_key(df_source)
            if detected_business_key and detected_business_key in df_source.columns and detected_business_key in df_target.columns:
                key_columns = [detected_business_key]
            else:
                key_columns = guess_key_columns(df_source, df_target)

        if not key_columns:
            raise ValueError("Could not determine key columns.")

        for col in key_columns:
            if col not in df_source.columns:
                df_source[col] = ""
            if col not in df_target.columns:
                df_target[col] = ""

        # Step 4: Reconcile Engine Execution
        db.update_recon_job_status(job_id, status="PROCESSING", progress_pct=70.0)
        data_type = resolve_data_type(req_data_type, df_source, df_target, key_columns)
        diff_report = difference_summary(df_source, df_target, key_columns, data_type)
        day_summary = extract_day_summary(df_source, df_target, key_columns, diff_report)

        source_label = "Source"
        target_label = "Target (Dummy Server)"
        insights = generate_plain_english_summary(diff_report, day_summary, key_columns, source_label, target_label)

        # Step 5: Save Series & excel reports
        db.update_recon_job_status(job_id, status="PROCESSING", progress_pct=90.0)
        
        diff_summary_meta = {
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

        series = create_series(series_name, source_filename, df_source, user_id=user_id, data_type=data_type)
        series_id = series["series_id"]
        db.upsert_series_metadata(series_id, series["name"], user_id=user_id)
        db.upsert_dataset(
            dataset_id=series_id,
            dataset_name=series["name"],
            original_file_name=source_filename,
            user_id=user_id,
            record_count=int(len(df_source)),
            file_type=source_filename.rsplit(".", 1)[-1].lower(),
            column_names=list(df_source.columns),
        )

        diff_report_filename = save_series_diff_json(series_id, 1, diff_report)
        excel_report_info = store_series_excel_report(
            series_id, series["name"], source_label, target_label, 1,
            diff_report, key_columns, day_summary,
            amount_source_col=amount_source_col, amount_target_col=amount_target_col,
        )
        version_entry = add_series_version(
            series_id, f"dummy-server:{project_name}/{entity_name}", df_target, key_columns,
            diff_summary_meta, excel_report_info["report_file"], label=target_label, data_type=data_type,
        )
        db.upsert_series_metadata(series_id, series["name"], key_columns, user_id=user_id)
        db.upsert_series_version(
            series_id, 1, target_label, f"dummy-server:{project_name}/{entity_name}",
            int(len(df_target)), int(len(df_target.columns)), key_columns, diff_summary_meta,
            excel_report_info["report_file"],
        )
        db.save_row_snapshot(series_id, 0, key_columns, df_source)
        db.save_row_snapshot(series_id, 1, key_columns, df_target)

        # Build response payload matches REST response
        result_payload = _sanitize({
            "series_id": series_id,
            "version": version_entry,
            "business_key": payload.get("business_key"),
            "key_columns": key_columns,
            "data_type": data_type,
            "compared_against_version": 0,
            "report": diff_report,
            "day_summary": day_summary,
            "insights": insights,
            "diff_report_file": diff_report_filename,
            "excel_report_file": excel_report_info["report_file"],
            "dummy_server_records_fetched": len(df_target),
        })

        db.update_recon_job_status(
            job_id,
            status="COMPLETED",
            progress_pct=100.0,
            result_summary=result_payload,
        )
        publish_recon_completed(job_id, result_payload)
        dummy_details = (
            f"Your Auto-Reconciliation job for project '{project_name}' (Entity: '{entity_name}') completed successfully.\n\n"
            f"Reconciliation Summary:\n"
            f"----------------------------------------\n"
            f"- Source Records: {len(df_source)}\n"
            f"- Target Records: {len(df_target)}\n"
            f"- Amount Mismatches: {diff_report['mismatches']['count']}\n"
            f"- Missing in Target (Deleted): {diff_report['missing_in_target']['count']}\n"
            f"- Missing in Source (Added): {diff_report['missing_in_source']['count']}\n"
            f"- Duplicates: {diff_report['duplicates_source']['count'] + diff_report['duplicates_target']['count']}\n"
            f"- Format Issues: {diff_report['format_inconsistencies']['count']}"
        )
        publish_notification_event(
            job_id=job_id,
            user_id=user_id,
            status="COMPLETED",
            details=dummy_details,
        )
        publish_audit_event("DUMMY_RECON_COMPLETED", {"job_id": job_id, "series_id": series_id}, user_id=user_id)
        logger.info(f"Successfully finished DUMMY_AUTO_RECONCILE Job: {job_id}")

    except Exception as exc:
        err_msg = f"{str(exc)}\n{traceback.format_exc()}"
        logger.error(f"Error executing Job {job_id}: {err_msg}")
        db.update_recon_job_status(
            job_id,
            status="FAILED",
            progress_pct=100.0,
            error_message=str(exc),
        )
        publish_notification_event(
            job_id=job_id,
            user_id=user_id,
            status="FAILED",
            details=f"Your Auto-Reconciliation job {job_id} failed: {str(exc)}.",
        )
        publish_audit_event("DUMMY_RECON_FAILED", {"job_id": job_id, "error": str(exc)}, user_id=user_id)


def process_erp_sync_event(payload: Dict[str, Any]):
    """Processes an event-driven ERP synchronization message."""
    logger.info(f"Received ERP Sync Event: {payload}")
    try:
        from dummy_integration.service import sync_and_reconcile
        project_name = payload.get("project_name", "cjbs")
        user_id = payload.get("user_id")
        result = sync_and_reconcile(project_name=project_name, user_id=user_id)
        logger.info(f"ERP Sync completed successfully for {project_name}")
        publish_audit_event("ERP_SYNC_COMPLETED", {"project_name": project_name, "result": result}, user_id=user_id)
    except Exception as exc:
        logger.error(f"ERP Sync failed: {exc}")


def process_notification_message(payload: Dict[str, Any]):
    """Processes notification event by querying user emails and sending email via SMTP or simulation."""
    job_id = str(payload.get("job_id", "job_unknown"))
    user_id = payload.get("user_id")
    status = payload.get("status")
    details = payload.get("details", "")

    recipient_emails = []

    # 1. Direct payload email specification
    direct_email = payload.get("email") or payload.get("user_email")
    if direct_email and str(direct_email).strip():
        recipient_emails.append(str(direct_email).strip())

    # 2. Fetch specific user email if user_id is provided
    if user_id is not None:
        try:
            from repositories import user_repository
            user = user_repository.get_user_by_id(user_id)
            if user and user.get("email"):
                recipient_emails.append(user["email"].strip())
        except Exception as e:
            logger.warning(f"Could not retrieve user info for ID {user_id}: {e}")

    # SMTP configuration from environment variables
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    try:
        smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    except ValueError:
        smtp_port = 587
    smtp_user = os.environ.get("SMTP_USER", "").strip()
    smtp_password = os.environ.get("SMTP_PASSWORD", "").strip().replace(" ", "")
    smtp_from = os.environ.get("SMTP_FROM_EMAIL", smtp_user).strip() or smtp_user

    # 3. Fallback recipient if no specific user email was found
    if not recipient_emails:
        fallback = smtp_from or smtp_user or os.environ.get("ADMIN_EMAIL", "admin@reconcilehub.com")
        if fallback:
            recipient_emails.append(fallback.strip())

    # Deduplicate recipient emails
    recipient_emails = list(dict.fromkeys([e for e in recipient_emails if e]))

    is_scheduled = job_id.startswith("sched_") or payload.get("is_scheduled", False)

    for user_email in recipient_emails:
        # If SMTP credentials are configured, attempt real email dispatch
        if smtp_user and smtp_password:
            try:
                import smtplib
                from email.mime.text import MIMEText
                from email.mime.multipart import MIMEMultipart

                logger.info(f"[Notification Service] ✉️ Attempting real email dispatch to {user_email} via SMTP ({smtp_host}:{smtp_port})...")
                
                # Create message
                msg = MIMEMultipart()
                msg["From"] = smtp_from
                msg["To"] = user_email
                if is_scheduled:
                    if status == "FAILED":
                        msg["Subject"] = f"❌ Scheduled Reconciliation Job Failed (ID: {job_id})"
                    elif status == "COMPLETED":
                        msg["Subject"] = f"⏰ Scheduled Reconciliation Job Completed (ID: {job_id})"
                    else:
                        msg["Subject"] = f"⏰ Scheduled Reconciliation Job Status: {status} (ID: {job_id})"
                else:
                    if status == "FAILED":
                        msg["Subject"] = f"❌ Reconciliation Job Failed (Job ID: {job_id})"
                    elif status == "COMPLETED":
                        msg["Subject"] = f"✅ Reconciliation Job Completed (Job ID: {job_id})"
                    else:
                        msg["Subject"] = f"Reconciliation Job Status: {status} (Job ID: {job_id})"
                
                # Email body
                body = f"""Hello,

Your reconciliation job has an updated status:

Job ID: {job_id}
Status: {status}

Details:
{details}

Best regards,
ReconcileHub Notification Service
"""
                msg.attach(MIMEText(body, "plain"))
                
                # Connect and send
                server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
                server.ehlo()
                if smtp_port == 587:
                    server.starttls()
                    server.ehlo()
                
                server.login(smtp_user, smtp_password)
                server.sendmail(smtp_from, [user_email], msg.as_string())
                server.quit()
                
                logger.info(f"[Notification Service] ✅ Real email sent successfully to {user_email}!")
            except Exception as smtp_err:
                logger.error(f"[Notification Service] ❌ Real email dispatch failed to {user_email}: {smtp_err}. Falling back to simulation log.")
                logger.info("=" * 70)
                logger.info(f"[Notification Service Simulator] ✉️ Simulating Email to: {user_email}")
                logger.info(f"   Subject: Reconciliation Job {status}! (Job ID: {job_id})")
                logger.info(f"   Details: {details}")
                logger.info("=" * 70)
        else:
            logger.info("[Notification Service] SMTP credentials not configured in environment. Using console simulation.")
            logger.info("=" * 70)
            logger.info(f"[Notification Service Simulator] ✉️ Simulating Email to: {user_email}")
            logger.info(f"   Subject: Reconciliation Job {status}! (Job ID: {job_id})")
            logger.info(f"   Details: {details}")
            logger.info("=" * 70)


def process_chat_job(job_id: str, payload: Dict[str, Any]):
    """Processes an asynchronous chatbot response job using Groq or Ollama."""
    logger.info(f"Starting CHAT_RESPONSE for Job ID: {job_id}")
    db.update_recon_job_status(job_id, status="PROCESSING", progress_pct=10.0)
    
    user_id = payload.get("user_id")
    message = payload.get("message")
    series_id = payload.get("series_id")
    version = payload.get("version")
    history = payload.get("history") or []
    provider = payload.get("provider")
    model = payload.get("model")

    try:
        from flask import g
        from app import app, build_dataset_chat_context, build_reconciliation_prompt
        from repositories import user_repository

        is_admin = False
        if user_id is not None:
            user = user_repository.get_user_by_id(user_id)
            if user and user.get("role") == "ADMIN":
                is_admin = True

        db.update_recon_job_status(job_id, status="PROCESSING", progress_pct=30.0)

        with app.test_request_context():
            g.current_user_id = user_id
            g.is_admin = is_admin
            
            context, error = build_dataset_chat_context(series_id, version, user_id=user_id)
            if error:
                raise Exception(error)

            prompt = build_reconciliation_prompt(message, context, history)
            
            db.update_recon_job_status(job_id, status="PROCESSING", progress_pct=50.0)
            
            # Import providers
            from groq_service import generate_response as groq_generate, GroqError
            from ollama_service import generate_response as ollama_generate, OllamaError

            note = None
            response_text = ""
            
            if provider == 'groq':
                try:
                    response_text = groq_generate(prompt, model=model)
                except GroqError as groq_exc:
                    try:
                        response_text = ollama_generate(prompt)
                    except OllamaError as ollama_exc:
                        raise Exception(f"Groq: {groq_exc}; Ollama: {ollama_exc}")
                    note = f"Groq model '{model or 'default'}' was unavailable ({groq_exc}). Answered by Ollama instead."
            elif provider == 'ollama':
                try:
                    response_text = ollama_generate(prompt, model=model)
                except OllamaError as exc:
                    raise Exception(str(exc))
            else:
                # Auto
                try:
                    response_text = groq_generate(prompt, model=model)
                except GroqError as groq_exc:
                    try:
                        response_text = ollama_generate(prompt)
                    except OllamaError as ollama_exc:
                        raise Exception(f"Groq: {groq_exc}; Ollama: {ollama_exc}")

            result_payload = {"response": response_text, "context": context}
            if note:
                result_payload["note"] = note
            
            db.update_recon_job_status(
                job_id,
                status="COMPLETED",
                progress_pct=100.0,
                result_summary=result_payload
            )
            publish_recon_completed(job_id, result_payload)
            logger.info(f"Successfully finished CHAT_RESPONSE Job: {job_id}")

    except Exception as exc:
        err_msg = f"{str(exc)}\n{traceback.format_exc()}"
        logger.error(f"Error executing CHAT_RESPONSE Job {job_id}: {err_msg}")
        db.update_recon_job_status(
            job_id,
            status="FAILED",
            progress_pct=100.0,
            error_message=str(exc),
        )
        publish_notification_event(
            job_id=job_id,
            user_id=user_id,
            status="FAILED",
            details=f"Your AI Chat response job {job_id} failed: {str(exc)}.",
        )


def run_worker():
    """Main background consumer loop."""
    logger.info("Initializing Kafka Consumer Worker...")
    
    # Ensure database schema is ready
    db.init_schema()

    # Ensure Kafka topics exist
    ensure_topics_exist()

    servers = [s.strip() for s in KAFKA_BOOTSTRAP_SERVERS.split(",") if s.strip()]
    logger.info(f"Connecting to Kafka brokers at: {servers}")

    from kafka import KafkaConsumer
    while True:
        try:
            consumer = KafkaConsumer(
                TOPIC_RECON_JOBS_QUEUED,
                TOPIC_ERP_SYNC_EVENTS,
                TOPIC_RECON_NOTIFICATIONS,
                bootstrap_servers=servers,
                client_id=f"{KAFKA_CLIENT_ID}-worker",
                group_id=KAFKA_CONSUMER_GROUP,
                auto_offset_reset="earliest",
                enable_auto_commit=True,
                value_deserializer=lambda m: json.loads(m.decode("utf-8")),
                key_deserializer=lambda k: k.decode("utf-8") if k else None,
                max_poll_interval_ms=300000,
            )
            logger.info(f"Worker subscribed to topics: {[TOPIC_RECON_JOBS_QUEUED, TOPIC_ERP_SYNC_EVENTS, TOPIC_RECON_NOTIFICATIONS]}")
            break
        except Exception as exc:
            logger.warning(f"Kafka broker not ready yet ({exc}). Retrying in 5 seconds...")
            time.sleep(5)

    try:
        for message in consumer:
            topic = message.topic
            payload = message.value
            key = message.key
            logger.info(f"Received message on topic: {topic}, key: {key}")

            if topic == TOPIC_RECON_JOBS_QUEUED:
                job_id = key or payload.get("job_id")
                if job_id:
                    job_type = payload.get("job_type", "AR_RECONCILE")
                    if job_type == "DUMMY_AUTO_RECONCILE":
                        process_dummy_reconcile_job(job_id, payload)
                    elif job_type == "CHAT_RESPONSE":
                        process_chat_job(job_id, payload)
                    else:
                        process_ar_reconciliation_job(job_id, payload)
            elif topic == TOPIC_ERP_SYNC_EVENTS:
                process_erp_sync_event(payload)
            elif topic == TOPIC_RECON_NOTIFICATIONS:
                process_notification_message(payload)


    except KeyboardInterrupt:
        logger.info("Worker shutting down gracefully...")
    finally:
        consumer.close()


if __name__ == "__main__":
    run_worker()
