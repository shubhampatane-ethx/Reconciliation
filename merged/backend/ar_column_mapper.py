"""
AR Column Mapper — schema-agnostic ingestion for AR reconciliation.
Synonyms loaded from ar_synonyms.json; new source systems onboarded by
editing JSON only.
"""
import re
import json
import difflib
import os
import pandas as pd

_SYNONYMS_PATH = os.path.join(os.path.dirname(__file__), "ar_synonyms.json")


def _load_synonyms():
    with open(_SYNONYMS_PATH, "r") as f:
        return json.load(f)


def _normalize(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def _all_syns_flat(canonical_fields: dict) -> set:
    return {s for syns in canonical_fields.values() for s in syns}


def detect_header_row(raw_df: pd.DataFrame, canonical_fields: dict, max_scan_rows: int = 10) -> int:
    """Scan first max_scan_rows rows and return the index of the row that best
    matches the synonym vocabulary — that row is the header."""
    all_syns = _all_syns_flat(canonical_fields)
    best_row, best_score = 0, -1
    for i in range(min(max_scan_rows, len(raw_df))):
        row_vals = [_normalize(v) for v in raw_df.iloc[i].tolist() if pd.notna(v) and str(v).strip()]
        score = sum(1 for v in row_vals if v in all_syns)
        if score > best_score:
            best_row, best_score = i, score
    return best_row


def map_columns(columns, canonical_fields: dict, manual_overrides: dict = None, fuzzy_cutoff: float = 0.6):
    """
    3-tier column resolution:
      Tier 1 — exact synonym match (normalised, case-insensitive)
      Tier 2 — fuzzy match via SequenceMatcher (cutoff configurable, default 0.6)
      Tier 3 — NOT_FOUND

    Returns (mapping, report_list)
      mapping:     {canonical_field: actual_column_name | None}
      report_list: [{field, matched_to, method, confidence}, ...]
    """
    manual_overrides = manual_overrides or {}
    norm_lookup = {_normalize(c): c for c in columns}
    mapping, report = {}, []
    used_columns = set()

    def _fuzzy_score(cand_norm: str, syn: str) -> float:
        ratio = difflib.SequenceMatcher(None, cand_norm, syn).ratio()
        # Boost: if the synonym is a substring of the column name (or vice-versa)
        if len(syn) >= 4 and (syn in cand_norm or cand_norm in syn):
            ratio = max(ratio, 0.85)
        return ratio

    for canonical, synonyms in canonical_fields.items():
        # Manual override wins unconditionally
        if canonical in manual_overrides:
            col = manual_overrides[canonical]
            mapping[canonical] = col
            report.append({"field": canonical, "matched_to": col, "method": "manual_override", "confidence": 1.0})
            if col:
                used_columns.add(col)
            continue

        # Tier 1 — exact normalised synonym match
        exact = next(
            (norm_lookup[s] for s in synonyms
             if s in norm_lookup and norm_lookup[s] not in used_columns),
            None
        )
        if exact:
            mapping[canonical] = exact
            report.append({"field": canonical, "matched_to": exact, "method": "exact_synonym", "confidence": 1.0})
            used_columns.add(exact)
            continue

        # Tier 2 — fuzzy match
        candidates = [c for c in columns if c not in used_columns]
        best_col, best_score = None, 0.0
        for cand in candidates:
            cand_n = _normalize(cand)
            score = max(_fuzzy_score(cand_n, syn) for syn in synonyms)
            if score > best_score:
                best_col, best_score = cand, score

        if best_col and best_score >= fuzzy_cutoff:
            mapping[canonical] = best_col
            report.append({"field": canonical, "matched_to": best_col, "method": "fuzzy_match", "confidence": round(best_score, 2)})
            used_columns.add(best_col)
        else:
            mapping[canonical] = None
            report.append({"field": canonical, "matched_to": None, "method": "NOT_FOUND", "confidence": 0.0})

    return mapping, report


def clean_amount(series: pd.Series) -> pd.Series:
    def _one(v):
        if pd.isna(v):
            return None
        s = str(v).strip()
        neg = s.startswith("(") and s.endswith(")")
        s = re.sub(r"[^0-9.\-]", "", s)
        if s in ("", "-", "."):
            return None
        try:
            val = float(s)
        except ValueError:
            return None
        return -abs(val) if neg else val
    return series.apply(_one)


def clean_date(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce", dayfirst=False)


def apply_mapping(df: pd.DataFrame, mapping: dict) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    for canonical, actual in mapping.items():
        if actual is not None and actual in df.columns:
            out[canonical] = df[actual]
        else:
            out[canonical] = pd.NA
    if "Amount" in out:
        out["Amount"] = clean_amount(out["Amount"])
    if "TxnDate" in out:
        out["TxnDate"] = clean_date(out["TxnDate"])
    if "DueDate" in out:
        out["DueDate"] = clean_date(out["DueDate"])
    return out


def detect_file_type(df: pd.DataFrame, synonyms_all: dict) -> dict:
    """
    Returns {"type": "transactional"|"master"|"ambiguous", "confidence": float, "signals": [...]}
    """
    txn_fields = synonyms_all.get("transactional", {})
    master_fields = synonyms_all.get("master", {})

    all_txn_syns = _all_syns_flat(txn_fields)
    all_master_syns = _all_syns_flat(master_fields)

    norm_cols = [_normalize(c) for c in df.columns]
    txn_header_score = sum(1 for c in norm_cols if c in all_txn_syns)
    master_header_score = sum(1 for c in norm_cols if c in all_master_syns)

    signals = []
    score = 0.0  # positive = transactional, negative = master

    # Signal 1: header vocabulary
    if txn_header_score > master_header_score:
        score += 0.35
        signals.append(f"Headers match transactional vocabulary ({txn_header_score} fields)")
    elif master_header_score > txn_header_score:
        score -= 0.35
        signals.append(f"Headers match master data vocabulary ({master_header_score} fields)")

    # Signal 2: date column with wide range
    date_col_found = False
    for col in df.columns:
        series = df[col].dropna().astype(str).str.strip()
        series = series[series != ""]
        if series.empty:
            continue
        parsed = pd.to_datetime(series, errors="coerce")
        if parsed.notna().mean() > 0.7:
            unique_dates = parsed.dropna().nunique()
            if unique_dates > max(5, len(df) * 0.1):
                score += 0.25
                signals.append(f"Date column '{col}' with wide range ({unique_dates} unique dates)")
                date_col_found = True
                break
    if not date_col_found and len(df) > 10:
        score -= 0.1

    # Signal 3: monetary amount column with variation
    for col in df.columns:
        series = df[col].dropna().astype(str).str.strip()
        cleaned = series.str.replace(r"[^\d.\-(]", "", regex=True)
        numeric = pd.to_numeric(cleaned, errors="coerce").dropna()
        if len(numeric) > max(3, len(df) * 0.5) and numeric.std() > 0:
            score += 0.2
            signals.append(f"Monetary column '{col}' with per-row variation")
            break

    # Signal 4: key cardinality
    if len(df) > 0:
        first_col = df.columns[0]
        col_series = df[first_col].astype(str).str.strip()
        non_empty = col_series[col_series != ""]
        if len(non_empty) > 0:
            uniqueness = non_empty.nunique() / len(non_empty)
            if uniqueness > 0.9:
                customer_like = [c for c in df.columns if _normalize(c) in {"customer", "customername", "clientname", "accountname"}]
                if customer_like:
                    cust_u = df[customer_like[0]].astype(str).str.strip().nunique() / max(len(df), 1)
                    if cust_u < 0.5:
                        score += 0.2
                        signals.append("Low-cardinality customer key (repeats across rows)")
            else:
                score -= 0.15
                signals.append("High key duplication ratio — suggests master data")

    # Signal 5: due date / aging columns
    due_syns = {"duedate", "paymentduedate", "aging", "agingdays", "paymentterms"}
    if any(c in due_syns for c in norm_cols):
        score += 0.2
        signals.append("Due date / aging column present")

    THRESHOLD = 0.25
    if score >= THRESHOLD:
        return {"type": "transactional", "confidence": round(min(1.0, 0.5 + score), 2), "signals": signals, "raw_score": round(score, 3)}
    elif score <= -THRESHOLD:
        return {"type": "master", "confidence": round(min(1.0, 0.5 + abs(score)), 2), "signals": signals, "raw_score": round(score, 3)}
    else:
        return {"type": "ambiguous", "confidence": round(0.5 - abs(score), 2), "signals": signals, "raw_score": round(score, 3)}


def load_and_map(df_raw: pd.DataFrame, canonical_fields: dict,
                 manual_overrides: dict = None, fuzzy_cutoff: float = 0.6) -> tuple:
    """
    Given a raw DataFrame (any layout), auto-detect the header row,
    promote it to column names, then map columns to canonical fields.

    Returns (std_df, mapping, report_list)
    """
    # --- detect header row ---
    hdr_row = detect_header_row(df_raw, canonical_fields)

    # Slice from header row onward; first row becomes column names
    df = df_raw.iloc[hdr_row:].copy().reset_index(drop=True)
    new_cols = [str(v).strip() if pd.notna(v) and str(v).strip() else f"Col_{i}"
                for i, v in enumerate(df.iloc[0])]
    df.columns = new_cols
    df = df.iloc[1:].reset_index(drop=True)

    # Drop completely empty columns
    df = df.dropna(axis=1, how="all")
    df = df.loc[:, ~(df == "").all()]

    # Drop rows that are entirely empty
    df = df.dropna(how="all").reset_index(drop=True)

    # Guard: drop a repeated header row (some exports double-print headers)
    all_syns = _all_syns_flat(canonical_fields)
    if len(df) > 0:
        first_row_norm = [_normalize(v) for v in df.iloc[0].tolist() if pd.notna(v)]
        if sum(1 for v in first_row_norm if v in all_syns) >= 2:
            df = df.iloc[1:].reset_index(drop=True)

    mapping, report = map_columns(df.columns.tolist(), canonical_fields, manual_overrides, fuzzy_cutoff)
    std = apply_mapping(df, mapping)
    return std, mapping, report
