"""
AR Reconciliation Engine — ports reconcile_v2.py logic.
Operates on canonically-mapped DataFrames from ar_column_mapper.
"""
import numpy as np
import pandas as pd


def split_exceptions(df: pd.DataFrame):
    """Separate rows with blank TxnNumber or null Amount into an exceptions bucket."""
    df = df.copy()
    id_is_na = df["TxnNumber"].isna()
    id_str = df["TxnNumber"].astype(str).str.strip()
    bad_id = id_is_na | id_str.str.lower().isin(["nan", "", "none", "<na>"])
    bad_amt = df["Amount"].isna() & ~bad_id
    exceptions = df[bad_id | bad_amt].copy()
    clean = df[~(bad_id | bad_amt)].copy()
    clean["TxnNumber"] = clean["TxnNumber"].astype(str).str.strip()
    return clean, exceptions


def _strip_suffix(txn_number: str) -> str:
    """Strip trailing -N suffix for Tier-2 matching (e.g. '123456-1' -> '123456')."""
    import re
    return re.sub(r"-\d+$", "", txn_number)


def reconcile(src_df: pd.DataFrame, tgt_df: pd.DataFrame, tolerance: float = 0.01) -> dict:
    """
    Reconcile two canonically-mapped DataFrames.
    Returns a results dict with all tabs required by the spec.
    """
    src_clean, src_exc = split_exceptions(src_df)
    tgt_clean, tgt_exc = split_exceptions(tgt_df)

    agg = {
        "Amount": ("Amount", "sum"),
        "TxnDate": ("TxnDate", "first"),
        "Customer": ("Customer", "first"),
    }
    # Only aggregate columns that exist
    agg = {k: v for k, v in agg.items() if v[0] in src_clean.columns and v[0] in tgt_clean.columns}

    # Only key on TxnType if it was ACTUALLY populated in both files (not just
    # present as an all-NA placeholder column, which apply_mapping() always
    # creates even for canonical fields that came back NOT_FOUND). Keying on
    # an all-NA column would make every row's TxnType == NaN, and pandas
    # groupby drops NaN keys by default -- silently zeroing every count.
    txn_type_usable = (
        "TxnType" in src_clean.columns and "TxnType" in tgt_clean.columns
        and not src_clean["TxnType"].isna().all()
        and not tgt_clean["TxnType"].isna().all()
    )
    key_cols = ["TxnNumber", "TxnType"] if txn_type_usable else ["TxnNumber"]

    # Detect duplicate keys before grouping
    dup_src = src_clean[src_clean.duplicated(subset=key_cols, keep=False)].copy()
    dup_tgt = tgt_clean[tgt_clean.duplicated(subset=key_cols, keep=False)].copy()

    grp_cols = [c for c in key_cols if c in src_clean.columns and c in tgt_clean.columns]
    src_grp = src_clean.groupby(grp_cols, as_index=False).agg(**agg) if agg else src_clean.drop_duplicates(subset=grp_cols)
    tgt_grp = tgt_clean.groupby(grp_cols, as_index=False).agg(**agg) if agg else tgt_clean.drop_duplicates(subset=grp_cols)

    merged = src_grp.merge(tgt_grp, on=grp_cols, how="outer", suffixes=("_Source", "_Target"), indicator=True)

    both = merged[merged._merge == "both"].copy()
    only_src = merged[merged._merge == "left_only"].copy()
    only_tgt = merged[merged._merge == "right_only"].copy()

    amt_src = "Amount_Source" if "Amount_Source" in both.columns else None
    amt_tgt = "Amount_Target" if "Amount_Target" in both.columns else None

    if amt_src and amt_tgt:
        both["Diff"] = both[amt_src].fillna(0) - both[amt_tgt].fillna(0)
        both["MatchStatus"] = np.where(both["Diff"].abs() <= tolerance, "Matched", "Amount Mismatch")
    else:
        both["Diff"] = 0.0
        both["MatchStatus"] = "Matched"

    matched = both[both["MatchStatus"] == "Matched"]
    mismatched = both[both["MatchStatus"] == "Amount Mismatch"]

    # Tier-2: suffix-stripped fallback for only_src / only_tgt
    tier2_rows = []
    if "TxnNumber" in only_src.columns and "TxnNumber" in only_tgt.columns:
        src_stripped = {_strip_suffix(str(r["TxnNumber"])): r for _, r in only_src.iterrows()}
        tgt_stripped = {_strip_suffix(str(r["TxnNumber"])): r for _, r in only_tgt.iterrows()}
        matched_keys = set(src_stripped.keys()) & set(tgt_stripped.keys())
        for key in matched_keys:
            sr = src_stripped[key]
            tr = tgt_stripped[key]
            diff = (sr.get(amt_src, 0) or 0) - (tr.get(amt_tgt, 0) or 0) if amt_src and amt_tgt else 0
            tier2_rows.append({
                "TxnNumber_Source": sr.get("TxnNumber"),
                "TxnNumber_Target": tr.get("TxnNumber"),
                "Amount_Source": sr.get(amt_src) if amt_src else None,
                "Amount_Target": tr.get(amt_tgt) if amt_tgt else None,
                "Diff": diff,
                "MatchStatus": "Tier2 Match" if abs(diff) <= tolerance else "Tier2 Amount Mismatch",
                "Customer": sr.get("Customer"),
            })
        # Remove tier2-matched keys from only_src/only_tgt
        tier2_src_nums = {r["TxnNumber_Source"] for r in tier2_rows}
        tier2_tgt_nums = {r["TxnNumber_Target"] for r in tier2_rows}
        only_src = only_src[~only_src["TxnNumber"].isin(tier2_src_nums)]
        only_tgt = only_tgt[~only_tgt["TxnNumber"].isin(tier2_tgt_nums)]

    def _df_to_records(df):
        records = []
        for row in df.to_dict(orient="records"):
            clean = {}
            for k, v in row.items():
                if v is None or (isinstance(v, float) and pd.isna(v)):
                    clean[k] = None
                elif isinstance(v, pd.Timestamp):
                    clean[k] = None if pd.isna(v) else v.isoformat()
                elif hasattr(v, 'item'):  # numpy scalar
                    clean[k] = v.item()
                else:
                    clean[k] = v
            records.append(clean)
        return records

    # Total invoice amounts — sum of ALL clean rows (pre-grouping), so repeated
    # invoice lines are included in the total, not collapsed by the groupby.
    src_invoice_total = float(src_clean["Amount"].dropna().sum()) if "Amount" in src_clean.columns else None
    tgt_invoice_total = float(tgt_clean["Amount"].dropna().sum()) if "Amount" in tgt_clean.columns else None
    invoice_difference = round(src_invoice_total - tgt_invoice_total, 2) if src_invoice_total is not None and tgt_invoice_total is not None else None

    # Keep grouped totals for backward compat
    src_total = float(src_grp["Amount"].sum()) if "Amount" in src_grp.columns else None
    tgt_total = float(tgt_grp["Amount"].sum()) if "Amount" in tgt_grp.columns else None

    return {
        "summary": {
            "source_records": int(len(src_grp)),
            "target_records": int(len(tgt_grp)),
            "matched": int(len(matched)),
            "amount_mismatch": int(len(mismatched)),
            "only_in_source": int(len(only_src)),
            "only_in_target": int(len(only_tgt)),
            "tier2_matches": len(tier2_rows),
            "source_exceptions": int(len(src_exc)),
            "target_exceptions": int(len(tgt_exc)),
            "duplicate_keys_source": int(len(dup_src)),
            "duplicate_keys_target": int(len(dup_tgt)),
            "source_invoice_total": round(src_invoice_total, 2) if src_invoice_total is not None else None,
            "target_invoice_total": round(tgt_invoice_total, 2) if tgt_invoice_total is not None else None,
            "invoice_difference": invoice_difference,
            "source_total": round(src_total, 2) if src_total is not None else None,
            "target_total": round(tgt_total, 2) if tgt_total is not None else None,
            "net_diff": round(src_total - tgt_total, 2) if src_total is not None and tgt_total is not None else None,
            "tolerance": tolerance,
        },
        "matched_rows": _df_to_records(matched),
        "mismatch_rows": _df_to_records(mismatched),
        "only_source_rows": _df_to_records(only_src),
        "only_target_rows": _df_to_records(only_tgt),
        "tier2_rows": tier2_rows,
        "duplicate_source_rows": _df_to_records(dup_src),
        "duplicate_target_rows": _df_to_records(dup_tgt),
        "source_exceptions": _df_to_records(src_exc),
        "target_exceptions": _df_to_records(tgt_exc),
    }
