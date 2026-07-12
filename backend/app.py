import os
from decimal import Decimal, InvalidOperation
from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
from io import BytesIO
from openpyxl import load_workbook

from storage import (
    delete_file, store_file, list_files, get_file_chunks, store_report, list_reports,
    create_series, list_series, get_series, add_series_version, delete_series, delete_all_series,
    load_version_dataframe, save_series_diff_json, load_series_diff_json,
    store_series_excel_report, delete_all_files, delete_all_reports,
)
from fuzzy_match import find_fuzzy_matches
from insights import generate_plain_english_summary
import db
from flask import send_file

app = Flask(__name__)
CORS(app)

# Best-effort: mirror series/version metadata into Postgres for the
# day-over-day value history feature. If DATABASE_URL isn't set or
# Postgres isn't reachable yet (e.g. local dev without `docker compose up
# db`), this quietly no-ops and the app keeps working on file storage
# alone — see db.py's is_available() guards.
db.init_schema()

ALLOWED_EXTENSIONS = {"csv", "xlsx", "xls"}
DATE_COLUMNS = ["date", "Date", "DATE", "transaction_date", "TransactionDate", "created_at", "CreatedAt"]


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def _read_excel_unmerged(content: bytes) -> pd.DataFrame:
    """Read the first sheet of an .xlsx/.xls upload the way a person actually
    sees it in Excel. When cells are merged (very common for a value that
    repeats down several rows — a project name, customer, description...),
    Excel stores the value only in the top-left cell of the merge. A plain
    pandas.read_excel() then reports every OTHER row in that merge as blank,
    which makes reconciliation think a value disappeared or a key went
    missing even though nothing actually changed in the source file.
    Here we unmerge every merged range in the DATA rows and copy the
    top-left value into every cell it covers, so the dataframe matches
    what's visually in the sheet before we ever start comparing rows.

    Merges that touch row 1 (the header row) are left alone — many
    real-world exports have a merged report title banner across the top
    row, and filling that across every header cell would give every column
    the same duplicate name and break the comparison outright.
    """
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

    # Give blank/duplicate header cells unique names — same safety net
    # pandas.read_excel already applied before this change — so a messy
    # header row can never make two columns compare-ambiguous downstream.
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
        # Legacy binary format — openpyxl can't open it, so fall back to the
        # old reader. (Merged-cell unmerging only applies to .xlsx uploads.)
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

    # 1) Exact match against the known list of common date-column names.
    for candidate in DATE_COLUMNS:
        key = candidate.lower()
        if key in common_lower:
            return lower_source[key]

    # 2) Any shared column whose name contains "date" (e.g. "Finish Date",
    # "Start Date", "Invoice Date") — prefer names ending in "date" over ones
    # that merely contain it (e.g. "Updated" would only match on substring).
    date_like = [k for k in common_lower if "date" in k]
    if date_like:
        date_like.sort(key=lambda k: (not k.endswith("date"), k))
        return lower_source[date_like[0]]

    # 3) Fall back to actually testing shared columns for parseable dates —
    # catches columns with no "date" in the name at all (e.g. "Timestamp",
    # "Period", "As Of"). A column qualifies if most non-empty values parse.
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


def canonical_value(value):
    text = "" if pd.isna(value) else str(value)
    stripped = text.strip()
    if stripped == "":
        return ""

    number_text = stripped.replace(",", "")
    if number_text.startswith("$"):
        number_text = number_text[1:]
    try:
        return f"number:{Decimal(number_text).normalize()}"
    except InvalidOperation:
        pass

    parsed_date = pd.to_datetime(stripped, errors="coerce")
    if not pd.isna(parsed_date):
        return f"date:{parsed_date.date().isoformat()}"

    return f"text:{stripped.casefold()}"


def row_key_series(df, key_columns):
    return df[key_columns].astype(str).apply(lambda row: "||".join([cell.strip() for cell in row]), axis=1)


def date_key(value):
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return "Undated"
    return parsed.date().isoformat()


def records_with_key(df, indexes, keys):
    rows = []
    for idx in indexes:
        record = df.loc[idx].to_dict()
        # Ensure every value is a plain string so the export never sees None.
        record = {k: ("" if pd.isna(v) else str(v)) for k, v in record.items()}
        record["_reconciliation_key"] = keys.loc[idx]
        rows.append(record)
    return rows


def _key_text(row, key_columns):
    """Build the human-readable key string used for fuzzy/vector matching
    (as opposed to row_key_series, which builds the exact-match key)."""
    return " ".join(str(row.get(col, "")) for col in key_columns).strip()


def _diff_row_pair(source_row, target_row, compare_columns):
    """Field-level diff between two flat row dicts. Mirrors the per-column
    comparison in difference_summary's merged-row loop, but works on plain
    dicts (records_with_key output) instead of a pandas merged row —
    needed because fuzzy-matched pairs never go through df.merge()."""
    row_mismatches = []
    row_formats = []
    for col in compare_columns:
        left_text = str(source_row.get(col, ""))
        right_text = str(target_row.get(col, ""))
        left_canonical = canonical_value(left_text)
        right_canonical = canonical_value(right_text)

        if left_text.strip() != right_text.strip() and left_canonical == right_canonical:
            row_formats.append({
                "column": col,
                "source_value": left_text,
                "target_value": right_text,
                "normalized_value": left_canonical.split(":", 1)[-1],
            })
        elif left_canonical != right_canonical:
            row_mismatches.append({
                "column": col,
                "source_value": left_text,
                "target_value": right_text,
            })
    return row_mismatches, row_formats


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
    merged = df_source.merge(df_target, on=key_columns, how="inner", suffixes=("_src", "_tgt"), indicator=False)
    merged = source_unique.merge(target_unique, on=key_columns, how="inner", suffixes=("_src", "_tgt"))
    mismatch_rows = []
    format_rows = []
    full_comparison_rows = []
    source_only_columns = [c for c in df_source.columns if c not in df_target.columns]
    target_only_columns = [c for c in df_target.columns if c not in df_source.columns]
    compare_columns = [c for c in df_source.columns if c in df_target.columns and c not in key_columns]

    # Vector/fuzzy matching: an exact key match already found everything it
    # could above. Whatever's left in missing_in_target_idx / missing_in_source_idx
    # genuinely has no identical-key counterpart — but some of those may still
    # be the SAME record with a renamed/retyped/typo'd key (e.g. "Alpha Proj"
    # -> "Project Alpha"), which would otherwise show up as a false
    # Deleted + Added pair instead of one real Updated row. Only the leftovers
    # are embedded and matched here — a clean exact match is never overridden.
    deleted_key_texts = {idx: _key_text(df_source.loc[idx], key_columns) for idx in missing_in_target_idx}
    added_key_texts = {idx: _key_text(df_target.loc[idx], key_columns) for idx in missing_in_source_idx}
    fuzzy_pairs, missing_in_target_idx, missing_in_source_idx = find_fuzzy_matches(
        deleted_key_texts, added_key_texts
    )

    fuzzy_rows = []
    for source_idx, target_idx, confidence in fuzzy_pairs:
        source_row_full = {k: ("" if pd.isna(v) else str(v)) for k, v in df_source.loc[source_idx].to_dict().items()}
        target_row_full = {k: ("" if pd.isna(v) else str(v)) for k, v in df_target.loc[target_idx].to_dict().items()}
        row_mismatches, row_formats = _diff_row_pair(source_row_full, target_row_full, compare_columns)
        changed_columns = [d["column"] for d in row_mismatches] + [d["column"] for d in row_formats]
        fuzzy_row = {
            "key_before": {col: source_row_full.get(col, "") for col in key_columns},
            "key_after": {col: target_row_full.get(col, "") for col in key_columns},
            "confidence": confidence,
            "changed_columns": changed_columns,
            "differences": row_mismatches,
            "format_differences": row_formats,
            "source_row": source_row_full,
            "target_row": target_row_full,
        }
        fuzzy_rows.append(fuzzy_row)
        full_comparison_rows.append({
            "key": fuzzy_row["key_after"],
            "status": "Renamed",
            "changed_columns": changed_columns,
            "source_row": source_row_full,
            "target_row": target_row_full,
            "match_confidence": confidence,
        })

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

            if left_text.strip() != right_text.strip() and left_canonical == right_canonical:
                row_formats.append({
                    "column": col,
                    "source_value": left_text,
                    "target_value": right_text,
                    "normalized_value": left_canonical.split(":", 1)[-1],
                })
            elif left_canonical != right_canonical:
                row_mismatches.append({
                    "column": col,
                    "source_value": left_text,
                    "target_value": right_text,
                })

        # Full before/after row snapshots, so a mismatch or format entry carries
        # the *entire* record (not just the one changed cell) for export/review.
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
        if row_formats:
            format_rows.append({
                "key": {col: row[col] for col in key_columns},
                "date": row_date,
                "differences": row_formats,
                "changed_columns": [d["column"] for d in row_formats],
                "source_row": source_row_full,
                "target_row": target_row_full,
            })

        # Every matched-key row (whether changed or not) goes into the full
        # side-by-side comparison so nothing is left out of the export.
        if row_mismatches:
            row_status = "Updated"
        elif row_formats:
            row_status = "Format Only"
        else:
            row_status = "Matched"
        full_comparison_rows.append({
            "key": {col: row[col] for col in key_columns},
            "status": row_status,
            "changed_columns": [d["column"] for d in row_mismatches] + [d["column"] for d in row_formats],
            "source_row": source_row_full,
            "target_row": target_row_full,
        })

    for entry in records_with_key(df_source, missing_in_target_idx, source_keys):
        entry = dict(entry)
        entry.pop("_reconciliation_key", None)
        full_comparison_rows.append({
            "key": {col: entry.get(col, "") for col in key_columns},
            "status": "Deleted",
            "changed_columns": [],
            "source_row": entry,
            "target_row": {},
        })

    for entry in records_with_key(df_target, missing_in_source_idx, target_keys):
        entry = dict(entry)
        entry.pop("_reconciliation_key", None)
        full_comparison_rows.append({
            "key": {col: entry.get(col, "") for col in key_columns},
            "status": "Added",
            "changed_columns": [],
            "source_row": {},
            "target_row": entry,
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
        "missing_in_target": {
            "count": len(missing_in_target_idx),
            "rows": records_with_key(df_source, missing_in_target_idx, source_keys),
        },
        "missing_in_source": {
            "count": len(missing_in_source_idx),
            "rows": records_with_key(df_target, missing_in_source_idx, target_keys),
        },
        "duplicates_source": {
            "count": len(duplicates_source),
            "rows": duplicates_source.to_dict(orient="records"),
        },
        "duplicates_target": {
            "count": len(duplicates_target),
            "rows": duplicates_target.to_dict(orient="records"),
        },
        "mismatches": {
            "count": len(mismatch_rows),
            "rows": mismatch_rows,
        },
        "format_inconsistencies": {
            "count": len(format_rows),
            "rows": format_rows,
        },
        "fuzzy_matches": {
            "count": len(fuzzy_rows),
            "rows": fuzzy_rows,
        },
        "full_comparison": {
            "count": len(full_comparison_rows),
            "rows": full_comparison_rows,
        },
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


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})


@app.route('/api/reconcile', methods=['POST'])
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

    # Persist the reconciliation report to backend storage with timestamp
    report_meta = store_report(diff_report, source_metadata, target_metadata, key_columns, day_summary)

    return jsonify({
        "key_columns": key_columns,
        "report": diff_report,
        "day_summary": day_summary,
        "insights": insights,
        "stored_files": [source_metadata, target_metadata],
        "report_meta": report_meta,
    })


@app.route('/api/stored-files', methods=['GET'])
def stored_files():
    files = list_files()
    return jsonify({"files": files})


@app.route('/api/stored-files', methods=['DELETE'])
def stored_files_delete_all():
    count = delete_all_files()
    return jsonify({"deleted": True, "count": count})


@app.route('/api/file-chunks/<file_id>', methods=['GET'])
def file_chunks(file_id):
    data = get_file_chunks(file_id)
    if data is None:
        return jsonify({"error": "File not found."}), 404
    return jsonify(data)


@app.route('/api/stored-files/<file_id>', methods=['DELETE'])
def stored_file_delete(file_id):
    deleted = delete_file(file_id)
    if not deleted:
        return jsonify({"error": "File not found."}), 404
    return jsonify({"deleted": True, "file_id": file_id})


@app.route('/api/reports/<report_name>', methods=['DELETE'])
def report_delete(report_name):
    safe_name = os.path.basename(report_name)
    path = os.path.join(os.path.dirname(__file__), 'vector_store', 'reports', safe_name)
    if not os.path.exists(path):
        return jsonify({"error": "Report not found."}), 404
    os.remove(path)
    return jsonify({"deleted": True, "report_file": safe_name})


@app.route('/api/stored-files/upload', methods=['POST'])
def stored_file_upload():
    """Upload a file directly to the Stored Files library (without reconciling)."""
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
def stored_file_preview(file_id):
    """Return the first N rows as a list-of-dicts for in-app table preview."""
    limit = int(request.args.get('limit', 200))
    data = get_file_chunks(file_id)
    if data is None:
        return jsonify({"error": "File not found."}), 404
    # Reconstruct rows from text chunks (each chunk is a row block)
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
    return jsonify({"file_id": file_id, "filename": data['metadata']['filename'],
                    "columns": list(rows[0].keys()) if rows else [],
                    "rows": rows[:limit], "total": len(rows)})


@app.route('/api/reports', methods=['GET'])
def reports_list():
    files = list_reports()
    return jsonify({"reports": files})


@app.route('/api/reports', methods=['DELETE'])
def reports_delete_all():
    count = delete_all_reports()
    return jsonify({"deleted": True, "count": count})


@app.route('/api/reports/<report_name>', methods=['GET'])
def report_download(report_name):
    # security: prevent path traversal
    safe_name = os.path.basename(report_name)
    path = os.path.join(os.path.dirname(__file__), 'vector_store', 'reports', safe_name)
    if not os.path.exists(path):
        return jsonify({"error": "Report not found."}), 404
    return send_file(path, as_attachment=True)


@app.route('/api/series', methods=['POST'])
def series_create():
    """Register a new version-chain series. The uploaded file becomes the
    untouched Source (Version 0) that everything else gets compared against."""
    if 'file' not in request.files:
        return jsonify({"error": "Please upload a source file as 'file'."}), 400

    source_file = request.files['file']
    if source_file.filename == '' or not allowed_file(source_file.filename):
        return jsonify({"error": "Allowed file types: csv, xls, xlsx."}), 400

    try:
        df_source = normalize_dataframe(read_dataframe(source_file))
    except Exception as exc:
        return jsonify({"error": f"Could not read file: {str(exc)}"}), 400

    name = request.form.get('name', '').strip()
    series = create_series(name, source_file.filename, df_source)

    # Mirror into Postgres. Row-level snapshots for Version 0 (the
    # baseline) get saved once key_columns are known, at the first
    # /versions call below — Version 0 has no key columns yet at creation.
    db.upsert_series_metadata(series["series_id"], series["name"])

    return jsonify({"series": series}), 201


@app.route('/api/series', methods=['GET'])
def series_list():
    return jsonify({"series": list_series()})


@app.route('/api/series/<series_id>', methods=['GET'])
def series_detail(series_id):
    series = get_series(series_id)
    if not series:
        return jsonify({"error": "Series not found."}), 404

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
def series_delete(series_id):
    deleted = delete_series(series_id)
    if not deleted:
        return jsonify({"error": "Series not found."}), 404
    db.delete_series_from_db(series_id)
    return jsonify({"deleted": True, "series_id": series_id})


@app.route('/api/series', methods=['DELETE'])
def series_delete_all():
    series_ids = [s["series_id"] for s in list_series()]
    count = delete_all_series()
    for series_id in series_ids:
        db.delete_series_from_db(series_id)
    return jsonify({"deleted": True, "count": count})


@app.route('/api/series/<series_id>/history', methods=['GET'])
def series_value_history(series_id):
    """Day-over-day value history for every tracked row, pivoted so each
    version/day is its own column — e.g. what did 'Cost Per Trip/Day' look
    like for Project Alpha on the Source day, Day 1, Day 2, Day 3?

    Backed by Postgres (series_row_values); requires DATABASE_URL to be
    configured and reachable, and for at least one version transition to
    have been run (that's when row snapshots get written).
    """
    if not db.is_available():
        return jsonify({
            "error": "History requires a connected Postgres database.",
            "db_connected": False,
        }), 503

    series = get_series(series_id)
    if not series:
        return jsonify({"error": "Series not found."}), 404

    only_changed = request.args.get('only_changed', 'true').lower() != 'false'
    history = db.get_value_history(series_id, only_changed=only_changed)
    return jsonify({
        "series_id": series_id,
        "db_connected": True,
        "versions": history["versions"],
        "entries": history["entries"],
    })


@app.route('/api/db/status', methods=['GET'])
def db_status():
    return jsonify({"connected": db.is_available()})


@app.route('/api/series/<series_id>/versions', methods=['POST'])
def series_add_version(series_id):
    """Upload the next day's file. It is automatically compared against the
    most recently stored version in this series (Day N-1 vs Day N), then
    becomes the new baseline for whatever comes next."""
    series = get_series(series_id)
    if not series:
        return jsonify({"error": "Series not found."}), 404

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
        # Reuse the key columns from the previous transition if we have them,
        # otherwise guess fresh ones from the two dataframes.
        key_columns = prev_version_entry.get("key_columns") or guess_key_columns(df_prev, df_new)

    if not key_columns:
        return jsonify({"error": "No key columns found. Provide key_columns or ensure common column names exist."}), 400

    for col in key_columns:
        if col not in df_prev.columns or col not in df_new.columns:
            return jsonify({"error": f"Key column '{col}' must exist in both the previous and new file."}), 400

    # difference_summary(source, target, ...): here "source" = previous day,
    # "target" = the newly uploaded day.
    #   missing_in_target -> rows that existed in the previous day but are gone now  -> DELETED
    #   missing_in_source  -> rows that are new in this day                          -> ADDED
    #   mismatches         -> rows present in both but with changed values           -> UPDATED
    diff_report = difference_summary(df_prev, df_new, key_columns)
    day_summary = extract_day_summary(df_prev, df_new, key_columns, diff_report)

    next_version = prev_version + 1
    label = request.form.get('label', '').strip() or f"Day {next_version}"

    insights = generate_plain_english_summary(diff_report, day_summary, key_columns, prev_version_entry["label"], label)

    diff_summary = {
        "added": diff_report["missing_in_source"]["count"],
        "deleted": diff_report["missing_in_target"]["count"],
        "duplicates": diff_report["duplicates_source"]["count"] + diff_report["duplicates_target"]["count"],
        "updated": diff_report["mismatches"]["count"],
        "renamed": diff_report["fuzzy_matches"]["count"],
        "format_issues": diff_report["format_inconsistencies"]["count"],
        "compared_against_version": prev_version,
        "compared_against_label": prev_version_entry["label"],
    }

    # Persist the day-wise summary and plain-English insights alongside the
    # diff so that re-opening any version later renders the full reconcile
    # layout (day-wise + narrative included) without recomputing anything.
    diff_report["day_summary"] = day_summary
    diff_report["insights"] = insights
    diff_report_filename = save_series_diff_json(series_id, next_version, diff_report)
    excel_report_info = store_series_excel_report(
        series_id,
        series["name"],
        prev_version_entry["label"],
        label,
        next_version,
        diff_report,
        key_columns,
        day_summary,
    )

    version_entry = add_series_version(
        series_id, new_file.filename, df_new, key_columns, diff_summary,
        excel_report_info["report_file"], label=label,
    )

    # Mirror into Postgres: version metadata + a full row snapshot for both
    # sides of this transition. The baseline (version 0) is only snapshotted
    # once we actually know key_columns, which is right here — if this is
    # the series' first-ever diff, prev_version is 0 and this call backfills
    # it; on later diffs it's a harmless no-op upsert of already-known data.
    db.upsert_series_metadata(series_id, series["name"], key_columns)
    db.upsert_series_version(
        series_id, next_version, label, new_file.filename,
        int(len(df_new)), int(len(df_new.columns)), key_columns, diff_summary,
        excel_report_info["report_file"],
    )
    db.save_row_snapshot(series_id, prev_version, key_columns, df_prev)
    db.save_row_snapshot(series_id, next_version, key_columns, df_new)

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
def series_version_report(series_id, version):
    """Full row-level diff report for one version transition (Day N-1 vs Day N)."""
    series = get_series(series_id)
    if not series:
        return jsonify({"error": "Series not found."}), 404
    if version == 0:
        return jsonify({"error": "Version 0 is the untouched Source file; there is nothing to diff it against."}), 400

    report = load_series_diff_json(series_id, version)
    if report is None:
        return jsonify({"error": "Report not found for this version."}), 404
    return jsonify({"series_id": series_id, "version": version, "report": report})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)