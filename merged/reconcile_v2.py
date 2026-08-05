"""
Reconciliation engine, v2 — column-name-agnostic.

Instead of hardcoded `.rename(columns={...})`, every file is passed through
`column_mapper.map_columns()` first. Whatever the two systems call their
fields, they get normalized onto the same canonical schema before anything
else happens. This is what makes the engine reusable next month if Oracle
or QuickBooks renames a column, or if this is pointed at a totally
different pair of AR systems.
"""
import pandas as pd
import numpy as np
from column_mapper import detect_header_row, map_columns, apply_mapping

SRC_PATH = "/mnt/user-data/uploads/AR_Dorse__Source_.xlsx"
TGT_PATH = "/mnt/user-data/uploads/AR_Dorse__Target_.xlsx"
TOLERANCE = 0.01

# Optional: force a mapping when the auto-detector can't be sure, or when
# you want to pin a field regardless of what the fuzzy matcher thinks.
SOURCE_OVERRIDES = {}
TARGET_OVERRIDES = {}

# -------------------------------------------------------------------
# 1. LOAD  (auto-detect header row — handles files where the header
#    isn't row 0, or where a second label row needs dropping)
# -------------------------------------------------------------------
def load_and_map(path, overrides, drop_first_data_row_if_header_like=True):
    raw = pd.read_excel(path, header=None)
    hdr_row = detect_header_row(raw)
    df = pd.read_excel(path, header=hdr_row)

    # If the row right after the header ALSO looks like a header (common in
    # QuickBooks-style exports with two label rows), drop it.
    if drop_first_data_row_if_header_like and len(df) > 0:
        all_synonyms = {s for syns in map_columns.__globals__["CANONICAL_FIELDS"].values() for s in syns}
        from column_mapper import _normalize
        first_row_vals = [_normalize(v) for v in df.iloc[0].tolist() if pd.notna(v)]
        score = sum(1 for v in first_row_vals if v in all_synonyms)
        if score >= 3:
            df = df.iloc[1:].reset_index(drop=True)

    mapping, report = map_columns(df.columns.tolist(), manual_overrides=overrides)
    std = apply_mapping(df, mapping)
    return std, mapping, report

src, src_map, src_map_report = load_and_map(SRC_PATH, SOURCE_OVERRIDES)
tgt, tgt_map, tgt_map_report = load_and_map(TGT_PATH, TARGET_OVERRIDES)

print("=== SOURCE COLUMN MAPPING ===")
print(src_map_report.to_string(index=False))
print("\n=== TARGET COLUMN MAPPING ===")
print(tgt_map_report.to_string(index=False))

unresolved = pd.concat([
    src_map_report.assign(File="Source"),
    tgt_map_report.assign(File="Target")
])
unresolved = unresolved[unresolved.method == "NOT_FOUND"]
if len(unresolved):
    print("\n*** FIELDS NOT AUTO-MAPPED (need manual_override or new synonym) ***")
    print(unresolved.to_string(index=False))

# -------------------------------------------------------------------
# 2. CLEAN / SPLIT EXCEPTIONS  (identical logic to v1, now schema-proof)
# -------------------------------------------------------------------
def split_exceptions(df):
    df = df.copy()
    id_is_na = df["TxnNumber"].isna()
    id_str = df["TxnNumber"].astype(str).str.strip()
    bad_id = id_is_na | id_str.str.lower().isin(["nan", "", "none", "<na>"])
    bad_amt = df["Amount"].isna() & ~bad_id
    exceptions = df[bad_id | bad_amt].copy()
    clean = df[~(bad_id | bad_amt)].copy()
    clean["TxnNumber"] = clean["TxnNumber"].astype(str).str.strip()
    return clean, exceptions

src_clean, src_exc = split_exceptions(src)
tgt_clean, tgt_exc = split_exceptions(tgt)

# -------------------------------------------------------------------
# 3. GROUP DUPLICATE KEYS, THEN TIER-1 / TIER-2 MATCH  (same as v1)
# -------------------------------------------------------------------
agg = dict(Amount=("Amount", "sum"), TxnDate=("TxnDate", "first"),
           Customer=("Customer", "first"))
src_grp = src_clean.groupby(["TxnNumber", "TxnType"], as_index=False).agg(**agg)
tgt_grp = tgt_clean.groupby(["TxnNumber", "TxnType"], as_index=False).agg(**agg)

merged = src_grp.merge(tgt_grp, on=["TxnNumber", "TxnType"], how="outer",
                        suffixes=("_Source", "_Target"), indicator=True)
both     = merged[merged._merge == "both"].copy()
only_src = merged[merged._merge == "left_only"].copy()
only_tgt = merged[merged._merge == "right_only"].copy()

both["Diff"] = both["Amount_Source"] - both["Amount_Target"]
both["MatchStatus"] = np.where(both.Diff.abs() <= TOLERANCE, "Matched", "Amount Mismatch")

print("\n=== RESULTS ===")
print("Source total:", round(src_grp.Amount.sum(), 2))
print("Target total:", round(tgt_grp.Amount.sum(), 2))
print("Net diff    :", round(src_grp.Amount.sum() - tgt_grp.Amount.sum(), 2))
print("Matched     :", (both.MatchStatus == "Matched").sum())
print("Mismatched  :", (both.MatchStatus == "Amount Mismatch").sum())
print("Only source :", len(only_src), round(only_src.Amount_Source.sum(), 2))
print("Only target :", len(only_tgt), round(only_tgt.Amount_Target.sum(), 2))
