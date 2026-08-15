"""
AR Column Mapper — deterministic, high-accuracy canonical schema mapping.

Source and Target files are mapped INDEPENDENTLY onto the same canonical
schema (this module is called once per file). No AI and no fuzzy/similarity
matching is used anywhere in this file.

Mapping priority (strict, in this order):
  1. Manual Override             - a user-pinned column always wins.
  2. Exact Synonym                - normalized column name is a known
                                     synonym for the canonical field, from
                                     ar_synonyms.json.
  3. Exact Normalized Column Name - normalized column name equals the
                                     normalized canonical field name itself
                                     (independent of the synonym list).
  4. Datatype / Sample-Value Validation - for canonical fields with a
                                     well-defined, unambiguous expected
                                     datatype (dates, amounts, emails,
                                     phone numbers, currency codes,
                                     high-cardinality identifiers), the
                                     single remaining unclaimed column whose
                                     sampled values validate against that
                                     datatype is accepted. Fields with no
                                     reliable datatype signature (free-text
                                     names, statuses, types, addresses, ...)
                                     never use this tier - they simply stop
                                     at NOT_FOUND rather than being guessed.
  Terminal:
    - REVIEW_REQUIRED  - more than one equally plausible candidate at tier
                          4 (or any other genuinely ambiguous situation).
                          Nothing is force-mapped.
    - NOT_FOUND        - no candidate matched at any tier.

Invariant: one physical column maps to at most one canonical field -
every tier only considers columns not already claimed (`used_columns`).

Performance (optimization only — does not alter mapping results):
  - `_normalize()` itself is memoized (lru_cache) so the same raw header
    string is never re-normalized twice, in this call or any other.
  - Per-schema derived structures (flattened synonym set, canonical-name
    normalization map) are computed once per loaded ar_synonyms.json and
    reused — no repeated full scans of the JSON per column or per file.
  - Within one map_columns() call, headers are normalized once into an
    in-memory dict (`norm_lookup`) — a single O(n_columns) pass, then every
    lookup against it is O(1). Column->normalized-name results are also
    cached across calls (keyed by the exact column tuple), so re-running
    mapping on the same file (e.g. "re-run with overrides") skips
    re-normalizing headers entirely.
  - ar_synonyms.json is loaded once and cached in-memory (invalidated only
    if the file's mtime changes) — zero repeated disk/database reads.
  - None of this changes *what* matches — only how fast the same,
    deterministic lookups are computed. Every lookup key is normalized to
    one exact, unique string, so caching can only skip redundant work, it
    can never merge or reinterpret two different columns as the same one.
"""
import re
import json
import os
from functools import lru_cache
import pandas as pd

_SYNONYMS_PATH = os.path.join(os.path.dirname(__file__), "ar_synonyms.json")

_NORM_RE = re.compile(r"[^a-z0-9]")


@lru_cache(maxsize=8192)
def _normalize_cached(s: str) -> str:
    return _NORM_RE.sub("", s.lower())


def _normalize(s) -> str:
    """Normalize a header: lowercase, then strip spaces, underscores,
    hyphens, and any other special characters - keep only [a-z0-9].
    Memoized: the same raw string is only ever run through the regex once,
    process-wide, then served from an in-memory hash lookup."""
    return _normalize_cached(str(s))


@lru_cache(maxsize=4)
def _load_synonyms_cached(_mtime: float) -> dict:
    with open(_SYNONYMS_PATH, "r") as f:
        return json.load(f)


def _load_synonyms() -> dict:
    """In-memory cached load of ar_synonyms.json. Cache key is the file's
    mtime, so editing the JSON (onboarding a new source system) is picked
    up automatically without a server restart, while normal repeated calls
    hit the cache instead of touching disk."""
    try:
        mtime = os.path.getmtime(_SYNONYMS_PATH)
    except OSError:
        mtime = 0.0
    return _load_synonyms_cached(mtime)


def _all_syns_flat(canonical_fields: dict) -> set:
    return {s for syns in canonical_fields.values() for s in syns}


# ---------------------------------------------------------------------------
# Derived-structure cache: per loaded `canonical_fields` dict (one entry per
# schema family — "transactional", "master"), precompute and reuse:
#   - flat_syns:  the full flattened synonym set (for header/file-type
#                 detection), instead of rebuilding it on every call.
#   - canon_norm: {canonical_field: normalized(canonical_field)} for tier 3,
#                 instead of re-normalizing every canonical field name on
#                 every map_columns() call.
# Safe to key by object identity: `_load_synonyms_cached` is itself
# lru_cache'd, so the same schema dict object is returned for as long as
# ar_synonyms.json's mtime is unchanged; a JSON edit produces a new dict
# object (new id), naturally invalidating the derived entry below it.
# ---------------------------------------------------------------------------
_derived_cache = {}


def _get_derived(canonical_fields: dict) -> dict:
    key = id(canonical_fields)
    cached = _derived_cache.get(key)
    if cached is not None:
        return cached
    flat_syns = _all_syns_flat(canonical_fields)
    canon_norm = {c: _normalize(c) for c in canonical_fields}
    derived = {"flat_syns": flat_syns, "canon_norm": canon_norm}
    if len(_derived_cache) > 16:
        _derived_cache.clear()  # simple bound; avoids unbounded growth
    _derived_cache[key] = derived
    return derived


# ---------------------------------------------------------------------------
# Normalized-column cache: for a given exact set of physical column names
# (as a tuple, order-preserving), the {normalized_name: original_name}
# lookup dict is built once and reused if the exact same columns are seen
# again (e.g. re-running mapping on the same uploaded file after supplying
# a manual override, or re-detecting the same file). Bounded LRU — this is
# a pure speed optimization; every key is still the single, exact,
# unique-per-column normalized string produced by `_normalize`, so it
# cannot change which column a canonical field resolves to.
# ---------------------------------------------------------------------------
@lru_cache(maxsize=256)
def _build_norm_lookup_cached(columns_tuple: tuple) -> dict:
    norm_lookup = {}
    for c in columns_tuple:
        norm_c = _normalize(c)
        norm_lookup.setdefault(norm_c, c)  # first physical column wins ties, deterministic
    return norm_lookup


def _build_norm_lookup(columns) -> dict:
    return _build_norm_lookup_cached(tuple(columns))



def detect_header_row(raw_df: pd.DataFrame, canonical_fields: dict, max_scan_rows: int = 10) -> int:
    """Scan first max_scan_rows rows and return the index of the row that best
    matches the synonym vocabulary (exact normalized match only) - that
    row is the header."""
    all_syns = _get_derived(canonical_fields)["flat_syns"]
    best_row, best_score = 0, -1
    for i in range(min(max_scan_rows, len(raw_df))):
        row_vals = [_normalize(v) for v in raw_df.iloc[i].tolist() if pd.notna(v) and str(v).strip()]
        score = sum(1 for v in row_vals if v in all_syns)
        if score > best_score:
            best_row, best_score = i, score
    return best_row


# ---------------------------------------------------------------------------
# Tier 4 - deterministic datatype / sample-value validators.
#
# Each validator receives a pandas Series of a candidate column's raw values
# and returns the fraction (0.0-1.0) of sampled non-null values that look
# like the expected type. A canonical field only participates in tier 4 if
# it has an entry here; everything else has no reliable datatype signature
# and is intentionally left out so it can never be silently guessed.
# ---------------------------------------------------------------------------
_DATE_FIELDS = {"TxnDate", "DueDate"}
_NUMERIC_FIELDS = {"Amount", "CreditLimit"}
_EMAIL_FIELDS = {"Email"}
_PHONE_FIELDS = {"Phone"}
_CURRENCY_FIELDS = {"Currency"}
_HIGH_CARDINALITY_ID_FIELDS = {"TxnNumber", "CustomerID", "PONumber", "TaxID"}

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_RE = re.compile(r"^\+?[0-9()\-.\s]{7,20}$")
_CURRENCY_RE = re.compile(r"^[A-Za-z]{3}$")
_ID_CHARSET_RE = re.compile(r"^[A-Za-z0-9\-_/#]+$")

_MIN_VALIDATION_SAMPLES = 3
_VALIDATION_THRESHOLD = 0.7
_ID_UNIQUENESS_THRESHOLD = 0.9
_ID_CHARSET_THRESHOLD = 0.9


def _sample(series: pd.Series, n: int = 200) -> pd.Series:
    s = series.dropna().astype(str).str.strip()
    s = s[s != ""]
    return s.head(n)


def _validate_date(s: pd.Series) -> float:
    if len(s) < _MIN_VALIDATION_SAMPLES:
        return 0.0
    parsed = pd.to_datetime(s, errors="coerce")
    return float(parsed.notna().mean())


def _validate_numeric(s: pd.Series) -> float:
    if len(s) < _MIN_VALIDATION_SAMPLES:
        return 0.0
    cleaned = s.str.replace(r"[^0-9.\-]", "", regex=True)
    numeric = pd.to_numeric(cleaned, errors="coerce")
    return float(numeric.notna().mean())


def _validate_email(s: pd.Series) -> float:
    if len(s) < _MIN_VALIDATION_SAMPLES:
        return 0.0
    return float(s.apply(lambda v: bool(_EMAIL_RE.match(v))).mean())


def _validate_phone(s: pd.Series) -> float:
    if len(s) < _MIN_VALIDATION_SAMPLES:
        return 0.0
    return float(s.apply(lambda v: bool(_PHONE_RE.match(v)) and sum(c.isdigit() for c in v) >= 7).mean())


def _validate_currency_code(s: pd.Series) -> float:
    if len(s) < _MIN_VALIDATION_SAMPLES:
        return 0.0
    return float(s.apply(lambda v: bool(_CURRENCY_RE.match(v))).mean())


def _validate_high_cardinality_id(s: pd.Series) -> float:
    if len(s) < _MIN_VALIDATION_SAMPLES:
        return 0.0
    uniqueness = s.nunique() / len(s)
    charset_ok = float(s.apply(lambda v: bool(_ID_CHARSET_RE.match(v))).mean())
    if uniqueness >= _ID_UNIQUENESS_THRESHOLD and charset_ok >= _ID_CHARSET_THRESHOLD:
        return uniqueness
    return 0.0


def _validator_for(canonical: str):
    if canonical in _DATE_FIELDS:
        return _validate_date
    if canonical in _NUMERIC_FIELDS:
        return _validate_numeric
    if canonical in _EMAIL_FIELDS:
        return _validate_email
    if canonical in _PHONE_FIELDS:
        return _validate_phone
    if canonical in _CURRENCY_FIELDS:
        return _validate_currency_code
    if canonical in _HIGH_CARDINALITY_ID_FIELDS:
        return _validate_high_cardinality_id
    return None


def map_columns(columns, canonical_fields: dict, manual_overrides: dict = None,
                 df_for_validation: pd.DataFrame = None, **_deprecated_kwargs):
    """
    Deterministic column resolution. No AI, no fuzzy/similarity scoring.

    Args:
      columns: list of actual column names in the file being mapped.
      canonical_fields: {canonical_field: [synonym, ...]} for ONE schema
                         family (e.g. synonyms_all["transactional"]).
      manual_overrides: {canonical_field: actual_column_name} - wins
                         unconditionally for the fields it covers.
      df_for_validation: the DataFrame these `columns` belong to, used to
                         pull sample values for tier 4. If omitted, tier 4
                         is skipped entirely (fields fall straight to
                         NOT_FOUND/REVIEW_REQUIRED instead of being guessed).

    Returns (mapping, report_list):
      mapping: {canonical_field: actual_column_name | None}
      report_list: [{field, matched_to, method, status, confidence,
                      candidates}, ...]
        status is one of: MAPPED, REVIEW_REQUIRED, NOT_FOUND.
    """
    # Backward-compat: older call sites may still pass fuzzy_cutoff -
    # fuzzy matching has been removed entirely, so it's accepted and
    # silently ignored rather than breaking existing callers.
    _deprecated_kwargs.pop("fuzzy_cutoff", None)

    manual_overrides = manual_overrides or {}

    # Hash/dictionary lookup for normalized column names, built once per
    # exact column set and cached (see _build_norm_lookup) - O(n_columns)
    # the first time a given file's headers are seen, O(1) lookups after
    # that, and skipped entirely on a re-run of the same file.
    norm_lookup = _build_norm_lookup(columns)
    canon_norm_map = _get_derived(canonical_fields)["canon_norm"]

    mapping, report = {}, []
    used_columns = set()

    # Tier-4 caches, scoped to this single map_columns() call: a column's
    # sampled values are pulled from the DataFrame at most once no matter
    # how many canonical fields test it, and a given (column, validator)
    # combination is scored at most once even if two canonical fields share
    # the same validator (e.g. TxnDate/DueDate both use the date validator).
    # Pure speed — same inputs always produce the same cached score.
    _sample_cache = {}
    _score_cache = {}

    def _sample_for(col):
        if col not in _sample_cache:
            _sample_cache[col] = _sample(df_for_validation[col])
        return _sample_cache[col]

    def _score_for(col, validator):
        cache_key = (col, validator)
        if cache_key not in _score_cache:
            _score_cache[cache_key] = validator(_sample_for(col))
        return _score_cache[cache_key]

    for canonical, synonyms in canonical_fields.items():
        # ---- Tier 1: manual override -------------------------------------
        override_col = manual_overrides.get(canonical)
        if override_col:
            mapping[canonical] = override_col
            report.append({
                "field": canonical, "matched_to": override_col,
                "method": "manual_override", "status": "MAPPED",
                "confidence": 1.0, "candidates": [override_col],
            })
            used_columns.add(override_col)
            continue

        # ---- Tier 2: exact synonym match (normalized) ---------------------
        # Iterate synonyms in file-defined order so results are stable and
        # reproducible regardless of hashing/set ordering.
        exact_syn = next(
            (norm_lookup[s] for s in synonyms
             if s in norm_lookup and norm_lookup[s] not in used_columns),
            None
        )
        if exact_syn:
            mapping[canonical] = exact_syn
            report.append({
                "field": canonical, "matched_to": exact_syn,
                "method": "exact_synonym", "status": "MAPPED",
                "confidence": 1.0, "candidates": [exact_syn],
            })
            used_columns.add(exact_syn)
            continue

        # ---- Tier 3: exact normalized canonical field name -----------------
        canon_norm = canon_norm_map[canonical]
        exact_name_col = norm_lookup.get(canon_norm)
        if exact_name_col and exact_name_col not in used_columns:
            mapping[canonical] = exact_name_col
            report.append({
                "field": canonical, "matched_to": exact_name_col,
                "method": "exact_normalized_name", "status": "MAPPED",
                "confidence": 1.0, "candidates": [exact_name_col],
            })
            used_columns.add(exact_name_col)
            continue

        # ---- Tier 4: datatype / sample-value validation ---------------------
        validator = _validator_for(canonical)
        validated = []
        if validator is not None and df_for_validation is not None:
            for col in columns:
                if col in used_columns or col not in df_for_validation.columns:
                    continue
                score = _score_for(col, validator)
                if score >= _VALIDATION_THRESHOLD:
                    validated.append((col, round(float(score), 4)))

        if len(validated) == 1:
            best_col, best_score = validated[0]
            mapping[canonical] = best_col
            report.append({
                "field": canonical, "matched_to": best_col,
                "method": "datatype_validation", "status": "MAPPED",
                "confidence": round(best_score, 2), "candidates": [best_col],
            })
            used_columns.add(best_col)
            continue

        if len(validated) > 1:
            # Ambiguous - more than one column plausibly validates for this
            # field. Never force/guess: surface for human review instead.
            mapping[canonical] = None
            report.append({
                "field": canonical, "matched_to": None,
                "method": "datatype_validation", "status": "REVIEW_REQUIRED",
                "confidence": 0.0,
                "candidates": [c for c, _ in validated],
            })
            continue

        # ---- Terminal: nothing matched at any tier ---------------------------
        mapping[canonical] = None
        report.append({
            "field": canonical, "matched_to": None,
            "method": "NOT_FOUND", "status": "NOT_FOUND",
            "confidence": 0.0, "candidates": [],
        })

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
    Unchanged: this is a heuristic file-type classifier, not the column
    mapper, and does not use fuzzy string matching (it scores against exact
    normalized header vocabulary plus structural signals).
    """
    txn_fields = synonyms_all.get("transactional", {})
    master_fields = synonyms_all.get("master", {})

    all_txn_syns = _get_derived(txn_fields)["flat_syns"] if txn_fields else set()
    all_master_syns = _get_derived(master_fields)["flat_syns"] if master_fields else set()

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
                signals.append("High key duplication ratio - suggests master data")

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
                  manual_overrides: dict = None, fuzzy_cutoff: float = None) -> tuple:
    """
    Given a raw DataFrame (any layout), auto-detect the header row,
    promote it to column names, then deterministically map columns to
    canonical fields (Source and Target are each mapped independently by
    calling this once per file).

    `fuzzy_cutoff` is accepted for backward compatibility with older
    callers/frontends but is unused - fuzzy matching has been removed.

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
    all_syns = _get_derived(canonical_fields)["flat_syns"]
    if len(df) > 0:
        first_row_norm = [_normalize(v) for v in df.iloc[0].tolist() if pd.notna(v)]
        if sum(1 for v in first_row_norm if v in all_syns) >= 2:
            df = df.iloc[1:].reset_index(drop=True)

    mapping, report = map_columns(df.columns.tolist(), canonical_fields,
                                   manual_overrides, df_for_validation=df)
    std = apply_mapping(df, mapping)
    return std, mapping, report
