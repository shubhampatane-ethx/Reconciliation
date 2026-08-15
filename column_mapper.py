"""
Generic, self-healing column mapper for reconciliation jobs.

Problem it solves: Source and Target files rarely use identical headers
("Trx Number/Cross Ref" vs "Transaction Number" vs "Invoice No" vs "Doc#").
Hard-coding a rename dict breaks the moment either system changes an export
template. This module maps ANY incoming header set onto a fixed set of
canonical fields using synonyms + fuzzy string matching, and tells you
exactly how confident each mapping is so nothing gets guessed silently.
"""
import re
import difflib
import pandas as pd

# --------------------------------------------------------------------
# 1. Canonical field -> known synonyms (lowercase, no spaces/punctuation)
#    Add new synonyms here as new source/target systems are onboarded.
# --------------------------------------------------------------------
CANONICAL_FIELDS = {
    "TxnNumber":  ["trxnumber", "trxnumbercrossref", "transactionnumber", "invoiceno",
                   "invoicenumber", "docnumber", "documentnumber", "num", "refno",
                   "billnumber", "voucherno", "doc"],
    "TxnType":    ["transactiontype", "trxtype", "type", "doctype", "documenttype"],
    "TxnDate":    ["trxdate", "transactiondate", "invoicedate", "docdate", "date",
                   "postingdate"],
    "Amount":     ["invoiceamount", "enteredamount", "amount", "openbalance",
                   "totalamount", "trxamount", "billamount", "amountdue"],
    "Customer":   ["customername", "billtocustomer", "customer", "clientname",
                   "accountname", "billtoname"],
    "PONumber":   ["ponumber", "po", "purchaseorderno", "pono"],
    "DueDate":    ["duedate", "paymentduedate"],
    "Salesperson":["salespersonname", "primarysalesperson", "salesrep", "salesperson"],
    "Currency":   ["currency", "currencycode"],
    "Status":     ["status", "complete", "trxstatus"],
}

def _normalize(s: str) -> str:
    """lowercase, strip everything that isn't a letter/digit"""
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def detect_header_row(raw_df: pd.DataFrame, max_scan_rows: int = 5) -> int:
    """
    Some exports (like the QuickBooks one) bury the real header a row or two
    down, or duplicate it. Score each of the first N rows by how many cells
    match a known synonym, and return the index of the best-scoring row.
    """
    all_synonyms = {s for syns in CANONICAL_FIELDS.values() for s in syns}
    best_row, best_score = 0, -1
    for i in range(min(max_scan_rows, len(raw_df))):
        row_vals = [_normalize(v) for v in raw_df.iloc[i].tolist() if pd.notna(v)]
        score = sum(1 for v in row_vals if v in all_synonyms)
        if score > best_score:
            best_row, best_score = i, score
    return best_row


def map_columns(columns, manual_overrides: dict | None = None, fuzzy_cutoff: float = 0.72):
    """
    Returns (mapping, report)
      mapping: {canonical_field: actual_column_name_or_None}
      report:  list of dicts describing HOW each field was resolved,
               for audit / manual review of anything uncertain.
    """
    manual_overrides = manual_overrides or {}
    norm_lookup = {_normalize(c): c for c in columns}
    mapping, report = {}, []
    used_columns = set()

    for canonical, synonyms in CANONICAL_FIELDS.items():
        # 1) explicit user override wins, no questions asked
        if canonical in manual_overrides:
            mapping[canonical] = manual_overrides[canonical]
            report.append({"field": canonical, "matched_to": manual_overrides[canonical],
                            "method": "manual_override", "confidence": 1.0})
            used_columns.add(manual_overrides[canonical])
            continue

        # 2) exact normalized synonym match
        exact = next((norm_lookup[s] for s in synonyms if s in norm_lookup
                      and norm_lookup[s] not in used_columns), None)
        if exact:
            mapping[canonical] = exact
            report.append({"field": canonical, "matched_to": exact,
                            "method": "exact_synonym", "confidence": 1.0})
            used_columns.add(exact)
            continue

        # 3) fuzzy match against every synonym, keep the best score.
        #    Plain ratio matching penalizes long compound headers (e.g.
        #    "Customer Name (Only Bill to/No Ship To)"), so for longer
        #    synonyms we also give credit for clean substring containment.
        candidates = [c for c in columns if c not in used_columns]
        best_col, best_score = None, 0.0

        def _score(cand_n, syn):
            ratio = difflib.SequenceMatcher(None, cand_n, syn).ratio()
            if len(syn) >= 6 and syn in cand_n:
                ratio = max(ratio, 0.9)
            return ratio

        for cand in candidates:
            cand_n = _normalize(cand)
            score = max(_score(cand_n, syn) for syn in synonyms)
            if score > best_score:
                best_col, best_score = cand, score

        if best_col and best_score >= fuzzy_cutoff:
            mapping[canonical] = best_col
            report.append({"field": canonical, "matched_to": best_col,
                            "method": "fuzzy_match", "confidence": round(best_score, 2)})
            used_columns.add(best_col)
        else:
            mapping[canonical] = None
            report.append({"field": canonical, "matched_to": None,
                            "method": "NOT_FOUND", "confidence": 0.0})

    return mapping, pd.DataFrame(report)


def clean_amount(series: pd.Series) -> pd.Series:
    """
    Handles the usual amount-format zoo: "$1,234.56", "(1,234.56)" for
    negatives, plain floats/ints, stray whitespace, text noise.
    """
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
    """Robust date parser that doesn't blow up on mixed formats."""
    return pd.to_datetime(series, errors="coerce")


def apply_mapping(df: pd.DataFrame, mapping: dict) -> pd.DataFrame:
    """Build a standard-schema dataframe from whatever the mapper found."""
    out = pd.DataFrame()
    for canonical, actual in mapping.items():
        out[canonical] = df[actual] if actual is not None else pd.NA
    if "Amount" in out:
        out["Amount"] = clean_amount(out["Amount"])
    if "TxnDate" in out:
        out["TxnDate"] = clean_date(out["TxnDate"])
    if "DueDate" in out:
        out["DueDate"] = clean_date(out["DueDate"])
    return out
