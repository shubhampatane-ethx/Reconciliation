import re
import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional, Tuple


def attach_internal_ids(df: pd.DataFrame, prefix: str) -> pd.DataFrame:
    """Attach stable technical internal record IDs (SRC_xxx, TGT_xxx) without mutating original columns."""
    df_copy = df.copy()
    if "_internal_id" not in df_copy.columns:
        df_copy["_internal_id"] = [f"{prefix}_{idx}" for idx in range(len(df_copy))]
    return df_copy


def normalize_text_val(val: Any) -> str:
    """Normalize text for lookup matching (lowercase, strip non-alphanumeric)."""
    if pd.isna(val) or val is None:
        return ""
    return re.sub(r'[^a-zA-Z0-9]', '', str(val).lower())


def auto_match_rows_by_keys(
    df_source: pd.DataFrame,
    df_target: pd.DataFrame,
    src_name_col: str,
    tgt_name_col: str,
    src_city_col: Optional[str] = None,
    tgt_city_col: Optional[str] = None,
    src_state_col: Optional[str] = None,
    tgt_num_col: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Automates 1-based data row lookup matching Source rows against Target rows.
    Primary Key: src_name_col (Source) = tgt_name_col (Target)
    Tie-Breaker: src_city_col (Source) = tgt_city_col (Target)
    
    Generates exact 0-based index pairs for Pandas execution AND 1-based data row reports.
    Handles single matches, multi-site matches (comma separated indices), and NO MATCH records.
    """
    # Detect default columns if not provided
    if not src_name_col or src_name_col not in df_source.columns:
        src_name_col = next((c for c in df_source.columns if re.search(r'entity|name|company|party', c, re.I)), df_source.columns[0])
    if not tgt_name_col or tgt_name_col not in df_target.columns:
        tgt_name_col = next((c for c in df_target.columns if re.search(r'party_name|name|entity|company', c, re.I)), df_target.columns[0])

    if not src_city_col or src_city_col not in df_source.columns:
        src_city_col = next((c for c in df_source.columns if re.search(r'city', c, re.I)), None)
    if not tgt_city_col or tgt_city_col not in df_target.columns:
        tgt_city_col = next((c for c in df_target.columns if re.search(r'city', c, re.I)), None)

    if not src_state_col or src_state_col not in df_source.columns:
        src_state_col = next((c for c in df_source.columns if re.search(r'state', c, re.I)), None)
    if not tgt_num_col or tgt_num_col not in df_target.columns:
        tgt_num_col = next((c for c in df_target.columns if re.search(r'number|no|code|id', c, re.I)), None)

    # Build target index map by normalized name
    target_name_map = {}
    for t_idx in range(len(df_target)):
        t_row = df_target.iloc[t_idx]
        norm_name = normalize_text_val(t_row[tgt_name_col])
        if norm_name:
            target_name_map.setdefault(norm_name, []).append(t_idx)

    generated_pairs = []
    report_rows = []

    no_match_count = 0
    name_city_count = 0
    name_only_count = 0
    multi_match_count = 0

    for s_idx in range(len(df_source)):
        s_row = df_source.iloc[s_idx]
        s_name = str(s_row[src_name_col]) if pd.notna(s_row[src_name_col]) else ""
        s_city = str(s_row[src_city_col]) if (src_city_col and pd.notna(s_row[src_city_col])) else ""
        s_state = str(s_row[src_state_col]) if (src_state_col and pd.notna(s_row[src_state_col])) else ""

        s_norm_name = normalize_text_val(s_name)
        matched_tgt_indices = target_name_map.get(s_norm_name, [])

        match_method = "NO MATCH"
        final_tgt_indices = []

        if not matched_tgt_indices:
            match_method = "NO MATCH"
            no_match_count += 1
        elif len(matched_tgt_indices) == 1:
            match_method = "Name Only"
            final_tgt_indices = matched_tgt_indices
            name_only_count += 1
        else:
            # Tie-breaker using city if multiple name matches exist
            if src_city_col and tgt_city_col and s_city:
                s_norm_city = normalize_text_val(s_city)
                city_matches = [
                    t_idx for t_idx in matched_tgt_indices
                    if normalize_text_val(df_target.iloc[t_idx][tgt_city_col]) == s_norm_city
                ]
                if len(city_matches) == 1:
                    match_method = "Name+City"
                    final_tgt_indices = city_matches
                    name_city_count += 1
                elif len(city_matches) > 1:
                    match_method = "Name+City (Multiple Sites)"
                    final_tgt_indices = city_matches
                    multi_match_count += 1
                else:
                    match_method = "Name Only (Multiple Sites)"
                    final_tgt_indices = matched_tgt_indices
                    multi_match_count += 1
            else:
                match_method = "Name Only (Multiple Sites)"
                final_tgt_indices = matched_tgt_indices
                multi_match_count += 1

        # Populate generated 0-based pair list for Pandas execution (takes first or all)
        for t_idx in final_tgt_indices:
            generated_pairs.append({"source_index": s_idx, "target_index": t_idx})

        # Target Party Name & Party Number strings
        if final_tgt_indices:
            tgt_names_str = ", ".join([str(df_target.iloc[t_idx][tgt_name_col]) for t_idx in final_tgt_indices])
            if tgt_num_col:
                tgt_nums_str = ", ".join([str(df_target.iloc[t_idx][tgt_num_col]) for t_idx in final_tgt_indices])
            else:
                tgt_nums_str = "—"
            tgt_row_idx_str = ", ".join([str(t_idx + 1) for t_idx in final_tgt_indices])
        else:
            tgt_names_str = "NO MATCH"
            tgt_nums_str = "NO MATCH"
            tgt_row_idx_str = "NO MATCH"

        report_rows.append({
            "Source_Row_Index": s_idx + 1,  # 1-based data row number
            "Source_Entity_Name": s_name,
            "Source_City": s_city,
            "Source_State": s_state,
            "Match_Method": match_method,
            "Match_Count": len(final_tgt_indices),
            "Target_Row_Index": tgt_row_idx_str,  # 1-based data row indices
            "Target_PARTY_NAME": tgt_names_str,
            "Target_PARTY_NUMBER": tgt_nums_str,
            "internal_source_index": s_idx,
            "internal_target_indices": final_tgt_indices,
        })

    return {
        "summary": {
            "total_source_rows": len(df_source),
            "total_target_rows": len(df_target),
            "total_pairs_generated": len(generated_pairs),
            "name_city_matches": name_city_count,
            "name_only_matches": name_only_count,
            "multi_site_matches": multi_match_count,
            "no_matches": no_match_count,
        },
        "generated_pairs": generated_pairs,
        "report_rows": report_rows,
        "detected_columns": {
            "source_name_column": src_name_col,
            "target_name_column": tgt_name_col,
            "source_city_column": src_city_col,
            "target_city_column": tgt_city_col,
            "source_state_column": src_state_col,
            "target_number_column": tgt_num_col,
        },
    }


def get_row_previews(
    df: pd.DataFrame,
    prefix: str,
    page: int = 1,
    page_size: int = 20,
    search_query: str = "",
) -> Dict[str, Any]:
    """Provides server-side paginated previews, index search, and value search for row mapping UI."""
    df_with_id = attach_internal_ids(df, prefix)
    
    # Filter by search query if provided
    filtered_indices = []
    search_q = str(search_query).strip().lower()

    if search_q:
        for idx, row in df_with_id.iterrows():
            row_str = " ".join([f"{k}:{v}" for k, v in row.items() if k != "_internal_id"]).lower()
            if search_q in str(idx) or search_q in row_str:
                filtered_indices.append(idx)
        matched_df = df_with_id.loc[filtered_indices]
    else:
        matched_df = df_with_id

    total_records = len(matched_df)
    start_idx = (page - 1) * page_size
    end_idx = min(start_idx + page_size, total_records)
    page_df = matched_df.iloc[start_idx:end_idx]

    records = []
    for idx, row in page_df.iterrows():
        row_dict = {}
        for col in page_df.columns:
            if col == "_internal_id":
                continue
            val = row[col]
            if pd.isna(val):
                row_dict[col] = None
            elif isinstance(val, (pd.Timestamp, np.datetime64)):
                row_dict[col] = str(val)
            else:
                row_dict[col] = val

        records.append({
            "index": int(idx),
            "internal_id": str(row["_internal_id"]),
            "data": row_dict,
        })

    return {
        "prefix": prefix,
        "total_records": total_records,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total_records + page_size - 1) // page_size),
        "records": records,
    }


def validate_row_mappings(
    row_mappings: List[Dict[str, int]],
    df_source: pd.DataFrame,
    df_target: pd.DataFrame,
) -> Tuple[bool, Optional[str]]:
    """Validates that requested source and target row indexes exist and contain no invalid duplicates."""
    src_len = len(df_source)
    tgt_len = len(df_target)

    seen_src = set()
    seen_tgt = set()

    for item in row_mappings:
        s_idx = item.get("source_index")
        t_idx = item.get("target_index")

        if s_idx is None or t_idx is None:
            return False, "Row mapping entries must specify both source_index and target_index."

        if not (0 <= s_idx < src_len):
            return False, f"Source Index {s_idx} out of bounds (Source dataset has {src_len} rows)."

        if not (0 <= t_idx < tgt_len):
            return False, f"Target Index {t_idx} out of bounds (Target dataset has {tgt_len} rows)."

        if s_idx in seen_src:
            return False, f"Duplicate Source Index {s_idx} selected in row mapping."
        seen_src.add(s_idx)

        if t_idx in seen_tgt:
            return False, f"Duplicate Target Index {t_idx} selected in row mapping."
        seen_tgt.add(t_idx)

    return True, None


def reconcile_by_row_indexing(
    df_source: pd.DataFrame,
    df_target: pd.DataFrame,
    row_mappings: List[Dict[str, int]],
    tolerance: float = 0.01,
) -> Dict[str, Any]:
    """
    Executes exact index-based row-to-row reconciliation in Pandas.
    Compares explicitly mapped row pairs cell-by-cell.
    Tracks mapped, matched, mismatched, and unmapped records cleanly.
    """
    src_with_ids = attach_internal_ids(df_source, "SRC")
    tgt_with_ids = attach_internal_ids(df_target, "TGT")

    valid, err_msg = validate_row_mappings(row_mappings, df_source, df_target)
    if not valid:
        raise ValueError(err_msg)

    # Determine common comparable columns (exact or normalized match)
    src_cols = [c for c in df_source.columns if c != "_internal_id"]
    tgt_cols = [c for c in df_target.columns if c != "_internal_id"]

    col_pairs = []
    tgt_cols_lower = {c.lower().replace(" ", "").replace("_", "").replace("-", ""): c for c in tgt_cols}

    for sc in src_cols:
        sc_norm = sc.lower().replace(" ", "").replace("_", "").replace("-", "")
        if sc in tgt_cols:
            col_pairs.append((sc, sc))
        elif sc_norm in tgt_cols_lower:
            col_pairs.append((sc, tgt_cols_lower[sc_norm]))

    mapped_src_indices = set()
    mapped_tgt_indices = set()

    matched_pairs = []
    mismatched_pairs = []

    for pair in row_mappings:
        s_idx = pair["source_index"]
        t_idx = pair["target_index"]

        mapped_src_indices.add(s_idx)
        mapped_tgt_indices.add(t_idx)

        s_row = src_with_ids.iloc[s_idx]
        t_row = tgt_with_ids.iloc[t_idx]

        field_diffs = []
        is_row_matched = True

        for sc, tc in col_pairs:
            s_val = s_row[sc]
            t_val = t_row[tc]

            s_is_na = pd.isna(s_val) or str(s_val).strip().lower() in ("nan", "none", "<na>", "")
            t_is_na = pd.isna(t_val) or str(t_val).strip().lower() in ("nan", "none", "<na>", "")

            if s_is_na and t_is_na:
                continue

            if s_is_na != t_is_na:
                is_row_matched = False
                field_diffs.append({
                    "source_field": sc,
                    "target_field": tc,
                    "source_value": None if s_is_na else str(s_val),
                    "target_value": None if t_is_na else str(t_val),
                    "status": "MISMATCH",
                })
                continue

            # Numeric tolerance check if both numeric
            try:
                s_num = float(str(s_val).replace(",", "").replace("$", ""))
                t_num = float(str(t_val).replace(",", "").replace("$", ""))
                if abs(s_num - t_num) > tolerance:
                    is_row_matched = False
                    field_diffs.append({
                        "source_field": sc,
                        "target_field": tc,
                        "source_value": s_val,
                        "target_value": t_val,
                        "difference": round(s_num - t_num, 4),
                        "status": "NUMERIC_MISMATCH",
                    })
                continue
            except (ValueError, TypeError):
                pass

            # String equality check
            if str(s_val).strip() != str(t_val).strip():
                is_row_matched = False
                field_diffs.append({
                    "source_field": sc,
                    "target_field": tc,
                    "source_value": str(s_val),
                    "target_value": str(t_val),
                    "status": "STRING_MISMATCH",
                })

        s_dict = {k: (v if pd.notna(v) else None) for k, v in s_row.to_dict().items() if k != "_internal_id"}
        t_dict = {k: (v if pd.notna(v) else None) for k, v in t_row.to_dict().items() if k != "_internal_id"}

        pair_record = {
            "source_index": s_idx,
            "target_index": t_idx,
            "source_internal_id": str(s_row["_internal_id"]),
            "target_internal_id": str(t_row["_internal_id"]),
            "status": "MATCHED" if is_row_matched else "MISMATCHED",
            "field_differences": field_diffs,
            "source_row": s_dict,
            "target_row": t_dict,
        }

        if is_row_matched:
            matched_pairs.append(pair_record)
        else:
            mismatched_pairs.append(pair_record)

    # Unmapped source rows
    unmapped_source = []
    for s_idx in range(len(df_source)):
        if s_idx not in mapped_src_indices:
            s_row = src_with_ids.iloc[s_idx]
            s_dict = {k: (v if pd.notna(v) else None) for k, v in s_row.to_dict().items() if k != "_internal_id"}
            unmapped_source.append({
                "source_index": s_idx,
                "source_internal_id": str(s_row["_internal_id"]),
                "source_row": s_dict,
            })

    # Unmapped target rows
    unmapped_target = []
    for t_idx in range(len(df_target)):
        if t_idx not in mapped_tgt_indices:
            t_row = tgt_with_ids.iloc[t_idx]
            t_dict = {k: (v if pd.notna(v) else None) for k, v in t_row.to_dict().items() if k != "_internal_id"}
            unmapped_target.append({
                "target_index": t_idx,
                "target_internal_id": str(t_row["_internal_id"]),
                "target_row": t_dict,
            })

    return {
        "mapping_mode": "ROW_INDEX",
        "summary": {
            "total_source_rows": len(df_source),
            "total_target_rows": len(df_target),
            "mapped_pairs_count": len(row_mappings),
            "matched_pairs_count": len(matched_pairs),
            "mismatched_pairs_count": len(mismatched_pairs),
            "unmapped_source_count": len(unmapped_source),
            "unmapped_target_count": len(unmapped_target),
        },
        "matched_rows": matched_pairs,
        "mismatch_rows": mismatched_pairs,
        "unmapped_source_rows": unmapped_source,
        "unmapped_target_rows": unmapped_target,
    }
