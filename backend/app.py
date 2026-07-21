import os
import json
from collections import Counter
from flask import Flask, g, request, jsonify
from flask_cors import CORS
import pandas as pd
from io import BytesIO
from openpyxl import load_workbook

from normalize import canonical_value
from storage import (
    delete_file, store_file, list_files, get_file_chunks, store_report, list_reports,
    create_series, list_series, list_series_for_user, get_series, add_series_version,
    delete_series, delete_all_series, load_version_dataframe, save_series_diff_json,
    load_series_diff_json, store_series_excel_report, delete_all_files, delete_all_reports,
)
from insights import generate_plain_english_summary
from ollama_service import generate_response, OllamaError
import db
from auth import configure_jwt, require_auth, optional_auth, auth_bp
from flask import send_file

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

# Initialise JWT (reads JWT_SECRET from env, configures Flask-JWT-Extended)
configure_jwt(app)

# Register auth routes (/api/auth/register, /api/auth/login, /api/auth/me)
app.register_blueprint(auth_bp)

# Initialise / migrate Postgres schema for datasets, series, versions, and
# row values. The `users` table is created/migrated separately via Alembic
# (`alembic upgrade head` — see backend/alembic/) since it's the ORM-backed
# entry point in models.py; run that before starting the app so the
# foreign keys below (series.user_id, datasets.user_id) resolve correctly.
db.init_schema()

ALLOWED_EXTENSIONS = {"csv", "xlsx", "xls"}
DATE_COLUMNS = [
    "date", "Date", "DATE", "transaction_date", "TransactionDate",
    "created_at", "CreatedAt",
]


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def _read_excel_unmerged(content: bytes) -> pd.DataFrame:
    """Read the first sheet of an .xlsx/.xls upload, unmerging merged cells
    so every data row carries the value a person sees in Excel rather than
    blanks for the continuation rows of a merge."""
    workbook = load_workbook(BytesIO(content), data_only=True)
    worksheet = workbook.active

    for merged_range in list(worksheet.merged_cells.ranges):
        min_col, min_row, max_col, max_row = merged_range.bounds
        if min_row <= 1:
            continue
        top_left_value = worksheet.cell(row=min_row, column=min_col).value
        worksheet.unmerge_cells(str(merged_range))
        for row in range(min_row, max_row + 1):
            for col in range(min_col, max_col + 1):
                worksheet.cell(row=row, column=col).value = top_left_value

    rows_iter = worksheet.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        return pd.DataFrame()

    columns = []
    seen = {}
    for idx, value in enumerate(header_row):
        name = str(value).strip() if value not in (None, "") else f"Unnamed: {idx}"
        if name in seen:
            seen[name] += 1
            name = f"{name}.{seen[name]}"
        else:
            seen[name] = 0
        columns.append(name)

    return pd.DataFrame(rows_iter, columns=columns)


def read_dataframe(file_storage):
    filename = file_storage.filename
    ext = filename.rsplit('.', 1)[1].lower()
    content = file_storage.read()
    if ext == 'csv':
        return pd.read_csv(BytesIO(content), dtype=str)
    if ext == 'xls':
        return pd.read_excel(BytesIO(content), dtype=str)
    return _read_excel_unmerged(content)


def normalize_dataframe(df):
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]
    df = df.fillna("")
    for col in df.columns:
        df[col] = df[col].astype(str)
    return df


def guess_key_columns(df_source, df_target):
    common = [col for col in df_source.columns if col in df_target.columns]
    if not common:
        return []
    lower_lookup = {col.lower(): col for col in common}
    for candidate in ("id", "key", "record_id", "transaction_id", "customer_id", "account_id"):
        if candidate in lower_lookup:
            return [lower_lookup[candidate]]
    return [common[0]]


def detect_date_column(df_source, df_target):
    lower_source = {col.lower(): col for col in df_source.columns}
    lower_target = {col.lower(): col for col in df_target.columns}
    common_lower = [k for k in lower_source if k in lower_target]

    for candidate in DATE_COLUMNS:
        key = candidate.lower()
        if key in common_lower:
            return lower_source[key]

    date_like = [k for k in common_lower if "date" in k]
    if date_like:
        date_like.sort(key=lambda k: (not k.endswith("date"), k))
        return lower_source[date_like[0]]

    best_col = None
    best_ratio = 0.0
    for key in common_lower:
        col = lower_source[key]
        series = df_source[col].dropna().astype(str).str.strip()
        series = series[series != ""]
        if series.empty:
            continue
        parsed = pd.to_datetime(series, errors="coerce")
        ratio = parsed.notna().mean()
        if ratio > 0.8 and ratio > best_ratio:
            best_ratio = ratio
            best_col = col
    return best_col


def row_key_series(df, key_columns):
    return df[key_columns].astype(str).apply(
        lambda row: "||".join([cell.strip() for cell in row]), axis=1
    )


def date_key(value):
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return "Undated"
    return parsed.date().isoformat()


def records_with_key(df, indexes, keys):
    rows = []
    for idx in indexes:
        record = df.loc[idx].to_dict()
        record = {k: ("" if pd.isna(v) else str(v)) for k, v in record.items()}
        record["_reconciliation_key"] = keys.loc[idx]
        rows.append(record)
    return rows


def difference_summary(df_source, df_target, key_columns):
    source_keys = row_key_series(df_source, key_columns)
    target_keys = row_key_series(df_target, key_columns)
    date_col = detect_date_column(df_source, df_target)

    missing_in_target_idx = source_keys[~source_keys.isin(target_keys)].index.tolist()
    missing_in_source_idx = target_keys[~target_keys.isin(source_keys)].index.tolist()

    duplicates_source = df_source[df_source.duplicated(subset=key_columns, keep=False)]
    duplicates_target = df_target[df_target.duplicated(subset=key_columns, keep=False)]

    source_unique = df_source.assign(_reconciliation_key=source_keys).drop_duplicates(subset=key_columns, keep="first")
    target_unique = df_target.assign(_reconciliation_key=target_keys).drop_duplicates(subset=key_columns, keep="first")
    merged = source_unique.merge(target_unique, on=key_columns, how="inner", suffixes=("_src", "_tgt"))
    mismatch_rows = []
    format_rows = []
    full_comparison_rows = []
    source_only_columns = [c for c in df_source.columns if c not in df_target.columns]
    target_only_columns = [c for c in df_target.columns if c not in df_source.columns]
    compare_columns = [c for c in df_source.columns if c in df_target.columns and c not in key_columns]

    # Fuzzy/vector-based rename matching is intentionally disabled: it was
    # producing false "Renamed" rows and complicating the Added/Deleted
    # counts. missing_in_target_idx / missing_in_source_idx are left as the
    # plain exact-key leftovers computed above.
    fuzzy_rows = []

    for _, row in merged.iterrows():
        row_mismatches = []
        row_formats = []
        for col in compare_columns:
            left = row.get(f"{col}_src", "")
            right = row.get(f"{col}_tgt", "")
            left_text = "" if pd.isna(left) else str(left)
            right_text = "" if pd.isna(right) else str(right)
            left_canonical = canonical_value(left_text)
            right_canonical = canonical_value(right_text)

            # If the underlying value is the same and only its display
            # formatting differs (e.g. "01/15/2027" vs "2027-01-15"), that
            # is NOT counted as a change — the row is still Matched. Only a
            # genuine value difference counts as an Updated row.
            if left_canonical != right_canonical:
                row_mismatches.append({
                    "column": col,
                    "source_value": left_text,
                    "target_value": right_text,
                })

        source_row_full = {col: row[col] for col in key_columns}
        source_row_full.update({col: row.get(f"{col}_src", "") for col in compare_columns})
        source_row_full.update({col: row.get(col, "") for col in source_only_columns})

        target_row_full = {col: row[col] for col in key_columns}
        target_row_full.update({col: row.get(f"{col}_tgt", "") for col in compare_columns})
        target_row_full.update({col: row.get(col, "") for col in target_only_columns})

        row_date = date_key(row.get(f"{date_col}_src", row.get(date_col, ""))) if date_col else "Undated"

        if row_mismatches:
            mismatch_rows.append({
                "key": {col: row[col] for col in key_columns},
                "date": row_date,
                "differences": row_mismatches,
                "changed_columns": [d["column"] for d in row_mismatches],
                "source_row": source_row_full,
                "target_row": target_row_full,
            })
        # Every matched-key row (whether changed or not) goes into the full
        # side-by-side comparison so nothing is left out of the export.
        row_status = "Updated" if row_mismatches else "Matched"
        full_comparison_rows.append({
            "key": {col: row[col] for col in key_columns},
            "status": row_status,
            "changed_columns": [d["column"] for d in row_mismatches],
            "source_row": source_row_full,
            "target_row": target_row_full,
        })

    for entry in records_with_key(df_source, missing_in_target_idx, source_keys):
        entry = dict(entry)
        entry.pop("_reconciliation_key", None)
        full_comparison_rows.append({
            "key": {col: entry.get(col, "") for col in key_columns},
            "status": "Deleted", "changed_columns": [],
            "source_row": entry, "target_row": {},
        })

    for entry in records_with_key(df_target, missing_in_source_idx, target_keys):
        entry = dict(entry)
        entry.pop("_reconciliation_key", None)
        full_comparison_rows.append({
            "key": {col: entry.get(col, "") for col in key_columns},
            "status": "Added", "changed_columns": [],
            "source_row": {}, "target_row": entry,
        })

    return {
        "source_record_count": int(len(df_source)),
        "target_record_count": int(len(df_target)),
        "date_column": date_col,
        "schema": {
            "source_columns": list(df_source.columns),
            "target_columns": list(df_target.columns),
            "source_only_columns": source_only_columns,
            "target_only_columns": target_only_columns,
        },
        "missing_in_target": {"count": len(missing_in_target_idx), "rows": records_with_key(df_source, missing_in_target_idx, source_keys)},
        "missing_in_source": {"count": len(missing_in_source_idx), "rows": records_with_key(df_target, missing_in_source_idx, target_keys)},
        "duplicates_source": {"count": len(duplicates_source), "rows": duplicates_source.to_dict(orient="records")},
        "duplicates_target": {"count": len(duplicates_target), "rows": duplicates_target.to_dict(orient="records")},
        "mismatches": {"count": len(mismatch_rows), "rows": mismatch_rows},
        "format_inconsistencies": {"count": len(format_rows), "rows": format_rows},
        "fuzzy_matches": {"count": len(fuzzy_rows), "rows": fuzzy_rows},
        "full_comparison": {"count": len(full_comparison_rows), "rows": full_comparison_rows},
    }


def extract_day_summary(df_source, df_target, key_columns, diff_report):
    date_col = diff_report.get("date_column")
    if not date_col:
        return []
    source = df_source.copy()
    target = df_target.copy()
    source["_day"] = source[date_col].apply(date_key)
    target["_day"] = target[date_col].apply(date_key)
    all_days = sorted(set(source["_day"]).union(set(target["_day"])))
    summary = []

    def count_rows(rows, day):
        return sum(1 for row in rows if date_key(row.get(date_col, "")) == day)

    def count_issue_rows(rows, day):
        return sum(1 for row in rows if row.get("date", "Undated") == day)

    for day in all_days:
        summary.append({
            "date": day,
            "source_records": int((source["_day"] == day).sum()),
            "target_records": int((target["_day"] == day).sum()),
            "missing_in_target": count_rows(diff_report["missing_in_target"]["rows"], day),
            "missing_in_source": count_rows(diff_report["missing_in_source"]["rows"], day),
            "duplicates_source": count_rows(diff_report["duplicates_source"]["rows"], day),
            "duplicates_target": count_rows(diff_report["duplicates_target"]["rows"], day),
            "mismatches": count_issue_rows(diff_report["mismatches"]["rows"], day),
            "format_inconsistencies": count_issue_rows(diff_report["format_inconsistencies"]["rows"], day),
        })
    return summary


# ── Health ────────────────────────────────────────────────────────────────────

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})


@app.route('/api/db/status', methods=['GET'])
def db_status():
    return jsonify({"connected": db.is_available()})


# ── Chat helpers ──────────────────────────────────────────────────────────────

def _top_mismatched_columns(diff_report, limit=5):
    counter = Counter()
    for bucket in ("mismatches", "format_inconsistencies", "fuzzy_matches"):
        for row in (diff_report.get(bucket) or {}).get("rows", []):
            for col in row.get("changed_columns") or []:
                counter[col] += 1
    return [{"column": col, "changes": n} for col, n in counter.most_common(limit)]


def _sample_keys(rows, key_columns, limit=8):
    samples = []
    for row in rows[:limit]:
        key = row.get("key") if isinstance(row, dict) and "key" in row else row
        if isinstance(key, dict):
            samples.append(", ".join(f"{k}={key.get(k, '')}" for k in (key_columns or key.keys())))
        else:
            samples.append(str(key))
    return samples


def build_dataset_chat_context(series_id, version=None, user_id=None):
    """Load reconciliation context for the AI assistant.

    When user_id is supplied (authenticated request) we verify ownership
    before returning anything — a user can never query another user's data.
    Returns (context_dict, error_message).
    """
    series = get_series(series_id)
    if not series:
        return None, "Selected dataset could not be found. It may have been deleted — please pick another dataset."

    # Ownership check: if we know who's asking, verify they own this series.
    if user_id is not None and db.is_available():
        owner = db.get_series_owner(series_id)
        if owner is not None and owner != user_id:
            return None, "Access denied — this dataset belongs to another user."

    versions = series.get("versions", [])
    if not versions:
        return None, f"Dataset '{series.get('name', series_id)}' has no data yet."

    if version is None:
        diff_versions = [v for v in versions if v["version"] > 0]
        version_entry = diff_versions[-1] if diff_versions else versions[-1]
        version = version_entry["version"]
    else:
        version_entry = next((v for v in versions if v["version"] == version), None)
        if version_entry is None:
            return None, f"Version {version} was not found in dataset '{series['name']}'."

    context = {
        "dataset_name": series["name"],
        "version": version,
        "version_label": version_entry.get("label"),
        "row_count": version_entry.get("row_count"),
        "column_count": version_entry.get("column_count"),
        "key_columns": version_entry.get("key_columns") or [],
    }

    if version == 0 or not version_entry.get("diff_summary"):
        context["status"] = "baseline_only"
        context["note"] = (
            f"Only the baseline file (Version 0, '{version_entry.get('label')}') has been uploaded for "
            f"'{series['name']}' — {version_entry.get('row_count', 0)} rows, "
            f"{version_entry.get('column_count', 0)} columns. No reconciliation comparison has been run yet."
        )
        return context, None

    diff_summary = version_entry.get("diff_summary") or {}
    context["compared_against_version"] = diff_summary.get("compared_against_version")
    context["compared_against_label"] = diff_summary.get("compared_against_label")

    diff_report = load_series_diff_json(series_id, version)

    if diff_report is None:
        context["status"] = "summary_only"
        context["note"] = (
            "The full row-level reconciliation report file was not found on disk; "
            "only the summary counts below are available for this version."
        )
        context["stats"] = {
            "added": diff_summary.get("added", 0),
            "deleted": diff_summary.get("deleted", 0),
            "updated": diff_summary.get("updated", 0),
            "renamed": diff_summary.get("renamed", 0),
            "duplicates": diff_summary.get("duplicates", 0),
            "format_issues": diff_summary.get("format_issues", 0),
        }
        return context, None

    context["status"] = "full_report"
    context["source_record_count"] = diff_report.get("source_record_count")
    context["target_record_count"] = diff_report.get("target_record_count")
    context["stats"] = {
        "missing_in_target_deleted": diff_report.get("missing_in_target", {}).get("count", 0),
        "missing_in_source_added": diff_report.get("missing_in_source", {}).get("count", 0),
        "mismatches_updated_values": diff_report.get("mismatches", {}).get("count", 0),
        "fuzzy_renamed_matches": diff_report.get("fuzzy_matches", {}).get("count", 0),
        "duplicates_in_source": diff_report.get("duplicates_source", {}).get("count", 0),
        "duplicates_in_target": diff_report.get("duplicates_target", {}).get("count", 0),
        "format_inconsistencies": diff_report.get("format_inconsistencies", {}).get("count", 0),
    }
    context["top_mismatched_columns"] = _top_mismatched_columns(diff_report)

    key_cols = context["key_columns"]
    context["sample_missing_in_target_deleted"] = _sample_keys(
        diff_report.get("missing_in_target", {}).get("rows", []), key_cols)
    context["sample_missing_in_source_added"] = _sample_keys(
        diff_report.get("missing_in_source", {}).get("rows", []), key_cols)
    context["sample_duplicate_keys_source"] = _sample_keys(
        diff_report.get("duplicates_source", {}).get("rows", []), key_cols)
    context["sample_duplicate_keys_target"] = _sample_keys(
        diff_report.get("duplicates_target", {}).get("rows", []), key_cols)

    day_summary = diff_report.get("day_summary") or []
    if day_summary:
        context["day_summary"] = day_summary

    insights = diff_report.get("insights") or {}
    if insights.get("narrative"):
        context["narrative_summary"] = insights["narrative"]
    if insights.get("churn_percent") is not None:
        context["churn_percent"] = insights["churn_percent"]
        context["churn_label"] = insights.get("churn_label")

    return context, None


def build_reconciliation_prompt(message, context, history):
    system_instructions = (
        "You are an AI Data Reconciliation Assistant.\n"
        "Answer ONLY using the supplied reconciliation context below. Never invent, guess, or "
        "estimate values that are not present in the context. If the information needed to answer "
        "is not available in the context, say plainly that it is unavailable.\n"
        "Explain reconciliation statistics in simple, plain language a non-technical business user "
        "can understand. Provide concise but informative answers, and reference concrete numbers "
        "from the context when relevant.\n"
    )

    prompt = system_instructions

    if context.get("status") == "baseline_only":
        prompt += f"\n<reconciliation context>\n{context['note']}\n</reconciliation context>\n"
    else:
        prompt += f"\n<reconciliation context>\n{json.dumps(context, default=str, indent=2)}\n</reconciliation context>\n"

    if history:
        prompt += "\nPrior conversation:\n"
        for turn in history[-10:]:
            role = 'User' if turn.get('role') == 'user' else 'Assistant'
            content = (turn.get('content') or '').strip()
            if content:
                prompt += f"{role}: {content}\n"

    prompt += f"\nUser: {message}"
    return prompt


# ── Chat API ──────────────────────────────────────────────────────────────────

@app.route('/api/chat', methods=['POST'])
@optional_auth
def chat():
    """Dataset-aware chatbot endpoint.

    Accepts:
      message     (str, required)
      series_id   (str, required) — which dataset to answer from
      version     (int, optional) — specific version; defaults to latest diff
      history     (list, optional) — prior turns for context
      model       (str, optional) — override OLLAMA_MODEL for this call

    When a valid JWT is present the user_id is used to enforce ownership:
    the assistant will refuse to answer questions about another user's dataset.
    Unauthenticated requests (dev/legacy) still work but skip the ownership check.
    """
    data = request.get_json(silent=True) or {}
    message = (data.get('message') or '').strip()
    series_id = data.get('series_id')
    version = data.get('version')
    history = data.get('history') or []
    model = data.get('model')

    if not message:
        return jsonify({"error": "message is required."}), 400

    if not series_id:
        return jsonify({"error": "Please select a dataset before asking questions."}), 400

    if version is not None:
        try:
            version = int(version)
        except (TypeError, ValueError):
            return jsonify({"error": "version must be a number."}), 400

    # g.current_user_id is set by @optional_auth — None when unauthenticated.
    user_id = getattr(g, 'current_user_id', None)
    context, error = build_dataset_chat_context(series_id, version, user_id=user_id)
    if error:
        return jsonify({"error": error}), 404

    prompt = build_reconciliation_prompt(message, context, history)

    try:
        response_text = generate_response(prompt, model=model)
    except OllamaError as exc:
        return jsonify({"error": str(exc)}), 503

    return jsonify({"response": response_text, "context": context})


# ── One-off reconcile (no series) ────────────────────────────────────────────

@app.route('/api/reconcile', methods=['POST'])
@optional_auth
def reconcile():
    if 'source_file' not in request.files or 'target_file' not in request.files:
        return jsonify({"error": "Please upload both source_file and target_file."}), 400

    source_file = request.files['source_file']
    target_file = request.files['target_file']

    if source_file.filename == '' or target_file.filename == '':
        return jsonify({"error": "Both files must have a filename."}), 400

    if not allowed_file(source_file.filename) or not allowed_file(target_file.filename):
        return jsonify({"error": "Allowed file types: csv, xls, xlsx."}), 400

    try:
        df_source = normalize_dataframe(read_dataframe(source_file))
        df_target = normalize_dataframe(read_dataframe(target_file))
    except Exception as exc:
        return jsonify({"error": f"Could not read files: {str(exc)}"}), 400

    key_columns = request.form.get('key_columns', '').strip()
    if key_columns:
        key_columns = [c.strip() for c in key_columns.split(',') if c.strip()]
    else:
        key_columns = guess_key_columns(df_source, df_target)

    if not key_columns:
        return jsonify({"error": "No key columns found. Provide key_columns or ensure common column names exist."}), 400

    for col in key_columns:
        if col not in df_source.columns or col not in df_target.columns:
            return jsonify({"error": f"Key column '{col}' must exist in both files."}), 400

    diff_report = difference_summary(df_source, df_target, key_columns)
    day_summary = extract_day_summary(df_source, df_target, key_columns, diff_report)
    insights = generate_plain_english_summary(diff_report, day_summary, key_columns, "Source", "Target")
    diff_report["insights"] = insights

    source_metadata = store_file(source_file.filename, df_source, "source")
    target_metadata = store_file(target_file.filename, df_target, "target")
    report_meta = store_report(diff_report, source_metadata, target_metadata, key_columns, day_summary)

    return jsonify({
        "key_columns": key_columns,
        "report": diff_report,
        "day_summary": day_summary,
        "insights": insights,
        "stored_files": [source_metadata, target_metadata],
        "report_meta": report_meta,
    })


# ── Stored files ──────────────────────────────────────────────────────────────

@app.route('/api/stored-files', methods=['GET'])
@optional_auth
def stored_files():
    files = list_files()
    return jsonify({"files": files})


@app.route('/api/stored-files', methods=['DELETE'])
@require_auth
def stored_files_delete_all():
    count = delete_all_files()
    return jsonify({"deleted": True, "count": count})


@app.route('/api/file-chunks/<file_id>', methods=['GET'])
@optional_auth
def file_chunks(file_id):
    data = get_file_chunks(file_id)
    if data is None:
        return jsonify({"error": "File not found."}), 404
    return jsonify(data)


@app.route('/api/stored-files/<file_id>', methods=['DELETE'])
@require_auth
def stored_file_delete(file_id):
    deleted = delete_file(file_id)
    if not deleted:
        return jsonify({"error": "File not found."}), 404
    return jsonify({"deleted": True, "file_id": file_id})


@app.route('/api/stored-files/upload', methods=['POST'])
@optional_auth
def stored_file_upload():
    if 'file' not in request.files:
        return jsonify({"error": "Please upload a file as 'file'."}), 400
    uploaded = request.files['file']
    if uploaded.filename == '' or not allowed_file(uploaded.filename):
        return jsonify({"error": "Allowed file types: csv, xls, xlsx."}), 400
    try:
        df = normalize_dataframe(read_dataframe(uploaded))
    except Exception as exc:
        return jsonify({"error": f"Could not read file: {str(exc)}"}), 400
    meta = store_file(uploaded.filename, df, "uploaded")
    return jsonify({"file": meta}), 201


@app.route('/api/stored-files/<file_id>/preview', methods=['GET'])
@optional_auth
def stored_file_preview(file_id):
    limit = int(request.args.get('limit', 200))
    data = get_file_chunks(file_id)
    if data is None:
        return jsonify({"error": "File not found."}), 404
    rows = []
    for chunk in (data.get('chunks') or []):
        text = chunk.get('text', '')
        record = {}
        for line in text.strip().split('\n'):
            if ': ' in line:
                col, val = line.split(': ', 1)
                record[col.strip()] = val.strip()
        if record:
            rows.append(record)
    return jsonify({
        "file_id": file_id,
        "filename": data['metadata']['filename'],
        "columns": list(rows[0].keys()) if rows else [],
        "rows": rows[:limit],
        "total": len(rows),
    })


# ── Reports ────────────────────────────────────────────────────────────────────

@app.route('/api/reports', methods=['GET'])
@optional_auth
def reports_list():
    return jsonify({"reports": list_reports()})


@app.route('/api/reports', methods=['DELETE'])
@require_auth
def reports_delete_all():
    count = delete_all_reports()
    return jsonify({"deleted": True, "count": count})


@app.route('/api/reports/<report_name>', methods=['GET'])
@optional_auth
def report_download(report_name):
    safe_name = os.path.basename(report_name)
    path = os.path.join(os.path.dirname(__file__), 'vector_store', 'reports', safe_name)
    if not os.path.exists(path):
        return jsonify({"error": "Report not found."}), 404
    return send_file(path, as_attachment=True)


@app.route('/api/reports/<report_name>', methods=['DELETE'])
@require_auth
def report_delete(report_name):
    safe_name = os.path.basename(report_name)
    path = os.path.join(os.path.dirname(__file__), 'vector_store', 'reports', safe_name)
    if not os.path.exists(path):
        return jsonify({"error": "Report not found."}), 404
    os.remove(path)
    return jsonify({"deleted": True, "report_file": safe_name})


# ── Datasets endpoint (user-scoped view of series) ────────────────────────────

@app.route('/api/datasets', methods=['GET'])
@require_auth
def datasets_list():
    """Return all datasets (series) that belong to the authenticated user.
    Falls back to the full series list when Postgres is unavailable so the
    UI never breaks in offline/dev mode."""
    user_id = g.current_user_id

    if db.is_available():
        owned_ids = set(db.list_series_for_user(user_id))
        all_series = list_series()
        user_series = [s for s in all_series if s["series_id"] in owned_ids]
    else:
        # Postgres down: fall back to storage.py's file-based list filtered
        # by the user_id stored in series metadata (if present).
        user_series = list_series_for_user(user_id)

    return jsonify({"datasets": user_series})


# ── Series (comparison chains) ────────────────────────────────────────────────

@app.route('/api/series', methods=['POST'])
@optional_auth
def series_create():
    """Register a new version-chain series. Automatically creates a dataset
    record with the same name as the uploaded file (Feature 1).
    The series is linked to the authenticated user when a JWT is present."""
    if 'file' not in request.files:
        return jsonify({"error": "Please upload a source file as 'file'."}), 400

    source_file = request.files['file']
    if source_file.filename == '' or not allowed_file(source_file.filename):
        return jsonify({"error": "Allowed file types: csv, xls, xlsx."}), 400

    try:
        df_source = normalize_dataframe(read_dataframe(source_file))
    except Exception as exc:
        return jsonify({"error": f"Could not read file: {str(exc)}"}), 400

    # Dataset name defaults to filename without extension (Feature 1)
    raw_name = request.form.get('name', '').strip()
    if not raw_name:
        raw_name = source_file.filename.rsplit('.', 1)[0]

    user_id = getattr(g, 'current_user_id', None)

    # Create the file-based series record (storage.py)
    series = create_series(raw_name, source_file.filename, df_source, user_id=user_id)

    # Mirror into Postgres — series metadata + dataset record
    db.upsert_series_metadata(series["series_id"], series["name"], user_id=user_id)
    db.upsert_dataset(
        dataset_id=series["series_id"],
        dataset_name=series["name"],
        original_file_name=source_file.filename,
        user_id=user_id,
        record_count=int(len(df_source)),
        file_type=source_file.filename.rsplit('.', 1)[-1].lower(),
        column_names=list(df_source.columns),
    )

    return jsonify({"series": series}), 201


@app.route('/api/series', methods=['GET'])
@optional_auth
def series_list():
    """List series. When authenticated, returns only the user's own series."""
    user_id = getattr(g, 'current_user_id', None)
    if user_id is not None:
        if db.is_available():
            owned_ids = set(db.list_series_for_user(user_id))
            all_series = list_series()
            return jsonify({"series": [s for s in all_series if s["series_id"] in owned_ids]})
        else:
            return jsonify({"series": list_series_for_user(user_id)})
    return jsonify({"series": list_series()})


@app.route('/api/series/<series_id>', methods=['GET'])
@optional_auth
def series_detail(series_id):
    user_id = getattr(g, 'current_user_id', None)
    series = get_series(series_id)
    if not series:
        return jsonify({"error": "Series not found."}), 404

    # Ownership guard
    if user_id is not None and db.is_available():
        owner = db.get_series_owner(series_id)
        if owner is not None and owner != user_id:
            return jsonify({"error": "Access denied."}), 403

    timeline = [
        {
            "version": v["version"],
            "label": v["label"],
            "uploaded_at": v["uploaded_at"],
            "row_count": v["row_count"],
            "added": (v.get("diff_summary") or {}).get("added", 0),
            "deleted": (v.get("diff_summary") or {}).get("deleted", 0),
            "updated": (v.get("diff_summary") or {}).get("updated", 0),
            "renamed": (v.get("diff_summary") or {}).get("renamed", 0),
            "format_issues": (v.get("diff_summary") or {}).get("format_issues", 0),
        }
        for v in series["versions"]
    ]
    return jsonify({"series": series, "timeline": timeline})


@app.route('/api/series/<series_id>', methods=['DELETE'])
@require_auth
def series_delete(series_id):
    user_id = g.current_user_id
    if db.is_available():
        owner = db.get_series_owner(series_id)
        if owner is not None and owner != user_id:
            return jsonify({"error": "Access denied."}), 403

    deleted = delete_series(series_id)
    if not deleted:
        return jsonify({"error": "Series not found."}), 404
    db.delete_series_from_db(series_id)
    return jsonify({"deleted": True, "series_id": series_id})


@app.route('/api/series', methods=['DELETE'])
@require_auth
def series_delete_all():
    user_id = g.current_user_id
    if db.is_available():
        owned_ids = set(db.list_series_for_user(user_id))
        all_series = list_series()
        series_to_delete = [s["series_id"] for s in all_series if s["series_id"] in owned_ids]
    else:
        series_to_delete = [s["series_id"] for s in list_series_for_user(user_id)]

    count = 0
    for sid in series_to_delete:
        if delete_series(sid):
            db.delete_series_from_db(sid)
            count += 1
    return jsonify({"deleted": True, "count": count})


# ── Series versions ───────────────────────────────────────────────────────────

@app.route('/api/series/<series_id>/versions', methods=['POST'])
@optional_auth
def series_add_version(series_id):
    """Upload the next day's file, reconcile it against the previous version."""
    user_id = getattr(g, 'current_user_id', None)

    series = get_series(series_id)
    if not series:
        return jsonify({"error": "Series not found."}), 404

    # Ownership check
    if user_id is not None and db.is_available():
        owner = db.get_series_owner(series_id)
        if owner is not None and owner != user_id:
            return jsonify({"error": "Access denied."}), 403

    if 'file' not in request.files:
        return jsonify({"error": "Please upload the new day's file as 'file'."}), 400

    new_file = request.files['file']
    if new_file.filename == '' or not allowed_file(new_file.filename):
        return jsonify({"error": "Allowed file types: csv, xls, xlsx."}), 400

    try:
        df_new = normalize_dataframe(read_dataframe(new_file))
    except Exception as exc:
        return jsonify({"error": f"Could not read file: {str(exc)}"}), 400

    prev_version_entry = series["versions"][-1]
    prev_version = prev_version_entry["version"]
    df_prev = load_version_dataframe(series_id, prev_version)
    if df_prev is None:
        return jsonify({"error": "Previous version data could not be loaded."}), 500

    key_columns = request.form.get('key_columns', '').strip()
    if key_columns:
        key_columns = [c.strip() for c in key_columns.split(',') if c.strip()]
    else:
        key_columns = prev_version_entry.get("key_columns") or guess_key_columns(df_prev, df_new)

    if not key_columns:
        return jsonify({"error": "No key columns found. Provide key_columns or ensure common column names exist."}), 400

    for col in key_columns:
        if col not in df_prev.columns or col not in df_new.columns:
            return jsonify({"error": f"Key column '{col}' must exist in both the previous and new file."}), 400

    diff_report = difference_summary(df_prev, df_new, key_columns)
    day_summary = extract_day_summary(df_prev, df_new, key_columns, diff_report)

    next_version = prev_version + 1
    label = request.form.get('label', '').strip() or f"Day {next_version}"

    insights = generate_plain_english_summary(
        diff_report, day_summary, key_columns, prev_version_entry["label"], label
    )

    diff_summary_meta = {
        "added": diff_report["missing_in_source"]["count"],
        "deleted": diff_report["missing_in_target"]["count"],
        "duplicates": diff_report["duplicates_source"]["count"] + diff_report["duplicates_target"]["count"],
        "updated": diff_report["mismatches"]["count"],
        "renamed": diff_report["fuzzy_matches"]["count"],
        "format_issues": diff_report["format_inconsistencies"]["count"],
        "compared_against_version": prev_version,
        "compared_against_label": prev_version_entry["label"],
    }

    diff_report["day_summary"] = day_summary
    diff_report["insights"] = insights
    diff_report_filename = save_series_diff_json(series_id, next_version, diff_report)
    excel_report_info = store_series_excel_report(
        series_id, series["name"], prev_version_entry["label"], label,
        next_version, diff_report, key_columns, day_summary,
    )

    version_entry = add_series_version(
        series_id, new_file.filename, df_new, key_columns, diff_summary_meta,
        excel_report_info["report_file"], label=label,
    )

    db.upsert_series_metadata(series_id, series["name"], key_columns, user_id=user_id)
    db.upsert_series_version(
        series_id, next_version, label, new_file.filename,
        int(len(df_new)), int(len(df_new.columns)), key_columns, diff_summary_meta,
        excel_report_info["report_file"],
    )
    db.save_row_snapshot(series_id, prev_version, key_columns, df_prev)
    db.save_row_snapshot(series_id, next_version, key_columns, df_new)

    # Append to reconciliation history in datasets table
    from datetime import datetime, timezone
    db.append_reconciliation_history(series_id, {
        "version": next_version,
        "label": label,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "added": diff_summary_meta["added"],
        "deleted": diff_summary_meta["deleted"],
        "updated": diff_summary_meta["updated"],
    })

    return jsonify({
        "series_id": series_id,
        "version": version_entry,
        "compared_against_version": prev_version,
        "key_columns": key_columns,
        "report": diff_report,
        "day_summary": day_summary,
        "insights": insights,
        "diff_report_file": diff_report_filename,
        "excel_report_file": excel_report_info["report_file"],
    }), 201


@app.route('/api/series/<series_id>/versions/<int:version>/report', methods=['GET'])
@optional_auth
def series_version_report(series_id, version):
    user_id = getattr(g, 'current_user_id', None)
    series = get_series(series_id)
    if not series:
        return jsonify({"error": "Series not found."}), 404
    if user_id is not None and db.is_available():
        owner = db.get_series_owner(series_id)
        if owner is not None and owner != user_id:
            return jsonify({"error": "Access denied."}), 403
    if version == 0:
        return jsonify({"error": "Version 0 is the baseline; nothing to diff against."}), 400
    report = load_series_diff_json(series_id, version)
    if report is None:
        return jsonify({"error": "Report not found for this version."}), 404
    return jsonify({"series_id": series_id, "version": version, "report": report})


# ── Value history (Postgres-backed day-over-day pivot) ────────────────────────

@app.route('/api/series/<series_id>/history', methods=['GET'])
@optional_auth
def series_value_history(series_id):
    if not db.is_available():
        return jsonify({"error": "History requires a connected Postgres database.", "db_connected": False}), 503

    user_id = getattr(g, 'current_user_id', None)
    series = get_series(series_id)
    if not series:
        return jsonify({"error": "Series not found."}), 404
    if user_id is not None and db.is_available():
        owner = db.get_series_owner(series_id)
        if owner is not None and owner != user_id:
            return jsonify({"error": "Access denied."}), 403

    only_changed = request.args.get('only_changed', 'true').lower() != 'false'
    history = db.get_value_history(series_id, only_changed=only_changed)
    return jsonify({
        "series_id": series_id,
        "db_connected": True,
        "versions": history["versions"],
        "entries": history["entries"],
    })


# =============================================================================
# DUMMY SERVER INTEGRATION — ADDITIVE ONLY
# =============================================================================
# Everything above this block is the ORIGINAL, unmodified reconciliation
# application (auth, uploads, comparison, reports, series/history, chat,
# etc.) — none of it was changed to add this feature.
#
# This registers ONE new, self-contained Blueprint (see
# backend/dummy_integration/routes.py) that exposes:
#
#     POST /api/dummy-integration/source-upload
#     POST /api/dummy-integration/auto-reconcile   <-- powers the
#          "Fetch Target automatically from Dummy Server" checkbox on the
#          Reconcile Over Time screen: the user uploads only a Source file,
#          and this endpoint detects its business key, calls the
#          independent Dummy Server (backend/dummy_server/app.py, run
#          separately on port 9000) for Target data, then runs it through
#          the EXISTING, UNCHANGED difference_summary()/extract_day_summary()
#          comparison engine and stores it as a normal Series — so it shows
#          up in "Reconcile Over Time", "Stored Files", and "Reports"
#          exactly like a manual two-file comparison would.
#     GET  /api/dummy-integration/scheduler/status
#     POST /api/dummy-integration/scheduler/trigger
#     GET  /api/dummy-integration/scheduler/last-result
try:
    from dummy_integration.routes import dummy_integration_bp
    app.register_blueprint(dummy_integration_bp)
except Exception as _dummy_integration_import_error:  # pragma: no cover
    # Defensive: if this optional module or its dependencies (SQLAlchemy,
    # requests, python-dotenv) aren't installed, the EXISTING app must still
    # start and work exactly as before — this feature is additive, not required.
    print(f"[dummy_integration] Skipped (not available): {_dummy_integration_import_error}")

# Background scheduler — auto-fetches Target data + reconciles on an
# interval (default every 10 minutes). Guarded the same way as the
# blueprint registration above: never prevents the rest of the app from
# starting if APScheduler isn't installed or the scheduler fails to start.
import os as _os
_is_reloader_process = _os.environ.get("WERKZEUG_RUN_MAIN") == "true"
_debug_mode = _os.environ.get("FLASK_DEBUG", "0") in ("1", "true", "True")

if not _debug_mode or _is_reloader_process:
    try:
        from dummy_integration.scheduler import start_scheduler, stop_scheduler
        _scheduler_instance = start_scheduler()

        import atexit as _atexit
        _atexit.register(stop_scheduler)
    except Exception as _sched_err:
        print(f"[scheduler] Could not start — scheduled reconciliation disabled: {_sched_err}")
# =============================================================================
# END DUMMY SERVER INTEGRATION
# =============================================================================

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
